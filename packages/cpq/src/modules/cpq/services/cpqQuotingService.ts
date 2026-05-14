import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import {
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteTargetSubscription,
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqOrderConfiguration,
  CpqProductOffering,
  CpqProductSpecification,
} from '../data/entities'
import type { DefaultCpqPricingService } from './cpqPricingService'
import type { DefaultCpqValidationService } from './cpqValidationService'
import type { DefaultCpqProductService } from './cpqProductService'
import type {
  CreateQuoteInput,
  QuoteItemInput,
  QuoteResult,
  QuoteLineResult,
  PricingSummary,
  ValidationError,
  ResolvedCharge,
  TenantScope,
  CpqStatus,
  CpqQuoteType,
  MergeAction,
  ArcReasonCode,
  ArcLineSource,
} from './types'
import {
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
  ARC_QUOTE_TYPES,
  getBaseCurrencyCode,
} from './types'

interface QuotingServiceDeps {
  em: EntityManager
  cpqPricingService: DefaultCpqPricingService
  cpqValidationService: DefaultCpqValidationService
  cpqProductService: DefaultCpqProductService
  salesDocumentNumberGenerator: SalesDocumentNumberGenerator
}

export class DefaultCpqQuotingService {
  private em: EntityManager
  private pricingService: DefaultCpqPricingService
  private validationService: DefaultCpqValidationService
  private productService: DefaultCpqProductService
  private numberGenerator: SalesDocumentNumberGenerator

  constructor(deps: QuotingServiceDeps) {
    this.em = deps.em
    this.pricingService = deps.cpqPricingService
    this.validationService = deps.cpqValidationService
    this.productService = deps.cpqProductService
    this.numberGenerator = deps.salesDocumentNumberGenerator
  }

  // ─── Create Quote ──────────────────────────────────────────────

  async createQuote(input: CreateQuoteInput, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    // Validate customer exists (lookup by id + tenantId; organizationId may differ
    // between CPQ scope resolution and how the core customers API resolves it)
    const customer = await em.findOne(CustomerEntity, {
      id: input.customerId,
      tenantId: scope.tenantId,
    }, { populate: ['personProfile', 'companyProfile'] })

    if (!customer) {
      throw new QuotingError(404, 'Customer not found')
    }

    // Build customer snapshot
    const customerSnapshot = buildCustomerSnapshot(customer)

    // Build initial quote context from customer
    const quoteContext: Record<string, string | number | boolean> = {
      ...(input.quoteContext ?? {}),
    }
    if (customer.kind) quoteContext.customer_type = customer.kind
    if (customer.companyProfile?.domain) quoteContext.customer_domain = customer.companyProfile.domain

    const currencyCode = input.currencyCode ?? await getBaseCurrencyCode(em, scope)

    let salesQuote: SalesQuote
    let salesQuoteId: string

    if (input.quoteId) {
      // Link to existing SalesQuote
      const existing = await em.findOne(SalesQuote, {
        id: input.quoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (!existing) throw new QuotingError(404, 'Sales quote not found')

      // Check if CPQ config already exists
      const existingConfig = await em.findOne(CpqQuoteConfiguration, {
        quoteId: input.quoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (existingConfig) {
        // Already initialized — just return the existing config
        const lines = await this.loadLineConfigs(em, existingConfig.id, scope)
        return this.buildQuoteResult(em, existingConfig, existing, lines)
      }

      salesQuote = existing
      salesQuoteId = existing.id
    } else {
      // Create new SalesQuote — assign UUID upfront so CpqQuoteConfiguration can reference it before flush
      salesQuoteId = crypto.randomUUID()

      const { number: quoteNumber } = await this.numberGenerator.generate({
        kind: 'quote',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      salesQuote = em.create(SalesQuote, {
        id: salesQuoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        quoteNumber,
        customerEntityId: input.customerId,
        customerSnapshot,
        currencyCode,
        subtotalNetAmount: '0',
        subtotalGrossAmount: '0',
        discountTotalAmount: '0',
        taxTotalAmount: '0',
        grandTotalNetAmount: '0',
        grandTotalGrossAmount: '0',
        lineItemCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(salesQuote)
    }

    // Create CpqQuoteConfiguration
    const cpqConfig = em.create(CpqQuoteConfiguration, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteId: salesQuoteId,
      customerId: input.customerId,
      cpqStatus: 'new',
      version: 1,
      currencyCode,
      quoteContext,
      validationResult: { valid: true, errors: [] },
      pricingSummary: emptyPricingSummary(currencyCode),
    })
    em.persist(cpqConfig)

    await em.flush()

    return this.buildQuoteResult(em, cpqConfig, salesQuote, [])
  }

  // ─── Add Quote Item ────────────────────────────────────────────

  async addQuoteItem(quoteId: string, item: QuoteItemInput, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    if (TERMINAL_STATUSES.includes(cpqConfig.cpqStatus as CpqStatus)) {
      throw new QuotingError(409, `Cannot modify quote in '${cpqConfig.cpqStatus}' status`)
    }

    // Resolve offering -> spec -> product
    const { offering, spec } = await this.resolveOffering(em, item, scope)

    // Merge context: quoteContext + designTimeValues + user configuration
    const mergedConfig = {
      ...(cpqConfig.quoteContext ?? {}),
      ...(offering?.designTimeValues ?? {}),
      ...item.configuration,
    }

    // If termMonths is provided, include it in the merged config for pricing
    if (item.termMonths) {
      mergedConfig.term_months = item.termMonths
    }

    // Validate configuration
    let validationErrors: ValidationError[] = []
    if (offering) {
      const validation = await this.validationService.validateOfferingConfiguration({
        offeringId: offering.id,
        configuration: item.configuration,
        scope,
      })
      validationErrors = validation.errors
    }

    // Resolve charges
    const charges = await this.pricingService.resolveProductCharges({
      offeringId: offering?.id,
      productId: item.productId ?? spec?.productId,
      configuration: mergedConfig,
      currencyCode: cpqConfig.currencyCode,
      ...scope,
    })

    const quantity = item.quantity ?? 1

    // Compute line totals
    const { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated } = computeLineTotals(charges, quantity, item.usageEstimates)

    const isBundleOffering = offering?.offeringType === 'bundle'
    const isConfigured = validationErrors.length === 0 && (charges.length > 0 || isBundleOffering)

    // Compute end date
    const endDate = computeEndDate(item.startDate, item.termMonths, item.endDate)

    // Get current line count
    const existingLines = await em.find(SalesQuoteLine, {
      quote: salesQuote,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const lineNumber = existingLines.length + 1

    // Per-instance unit price (NRC + MRC for one instance)
    const perInstanceNrc = charges.filter((c) => c.chargeType === 'nrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const perInstanceMrc = charges.filter((c) => c.chargeType === 'mrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const unitPriceNet = perInstanceNrc + perInstanceMrc
    const totalNetAmount = unitPriceNet * quantity

    // Create SalesQuoteLine — assign UUID upfront so CpqQuoteLineConfiguration can reference it
    const quoteLineId = crypto.randomUUID()
    const quoteLine = em.create(SalesQuoteLine, {
      id: quoteLineId,
      quote: salesQuote,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      lineNumber,
      kind: 'product',
      productId: spec?.productId ?? item.productId ?? null,
      name: offering?.name ?? spec?.name ?? 'Configured Item',
      quantity: String(quantity),
      unitPriceNet: String(unitPriceNet),
      unitPriceGross: String(unitPriceNet),
      totalNetAmount: String(totalNetAmount),
      totalGrossAmount: String(totalNetAmount),
      discountAmount: '0',
      discountPercent: '0',
      taxRate: '0',
      taxAmount: '0',
      currencyCode: cpqConfig.currencyCode,
      configuration: {
        offeringId: offering?.id ?? null,
        offeringCode: offering?.code ?? null,
        action: item.action ?? 'add',
        nrcTotal: Number(nrcTotal),
        mrcTotal: Number(mrcTotal),
        parentLineId: item.parentLineId ?? null,
      },
      normalizedQuantity: String(quantity),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quoteLine)

    // XD-250 ARC: a new line on an ARC quote must point at one of the
    // attached target subscriptions (validateArcQuote enforces this on
    // submit-for-approval). Auto-inherit when there's exactly one target;
    // for merge-renew (≥2 targets, all 'absorb') leave it null per spec.
    // The operator can override via item.targetSubscriptionId when a quote
    // has multiple non-merge targets.
    const arcTargetSubscriptionId = await resolveArcLineTargetSubscriptionId(
      em,
      cpqConfig,
      scope,
      item.targetSubscriptionId ?? undefined,
    )

    // Create CpqQuoteLineConfiguration
    const lineConfig = em.create(CpqQuoteLineConfiguration, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteLineId: quoteLine.id,
      quoteConfigurationId: cpqConfig.id,
      offeringId: offering?.id ?? null,
      productId: spec?.productId ?? item.productId ?? null,
      specId: spec?.id ?? null,
      action: item.action ?? 'add',
      parentLineId: item.parentLineId ?? null,
      startDate: item.startDate ? new Date(item.startDate) : null,
      termMonths: item.termMonths ?? null,
      endDate: endDate ? new Date(endDate) : null,
      configuration: item.configuration,
      quantity,
      charges: charges as unknown as Array<Record<string, unknown>>,
      nrcTotal: String(nrcTotal),
      mrcTotal: String(mrcTotal),
      usageEstimates: usageEstimates ?? null,
      usageTotalEstimated: usageTotalEstimated != null ? String(usageTotalEstimated) : null,
      validationErrors: validationErrors.length > 0 ? validationErrors as unknown as Array<Record<string, unknown>> : null,
      isConfigured,
      targetSubscriptionId: arcTargetSubscriptionId,
    })
    em.persist(lineConfig)

    await em.flush()

    // Recalculate quote-level totals
    return this.recalculateInternal(em, cpqConfig, salesQuote, scope, true)
  }

  // ─── Update Quote Item ─────────────────────────────────────────

  async updateQuoteItem(
    quoteId: string,
    lineId: string,
    update: { configuration: Record<string, unknown>; quantity?: number; usageEstimates?: Array<{ chargeCode: string; estimatedQuantity: number }>; startDate?: string; termMonths?: number; endDate?: string },
    scope: TenantScope,
  ): Promise<QuoteResult> {
    const em = this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    if (TERMINAL_STATUSES.includes(cpqConfig.cpqStatus as CpqStatus)) {
      throw new QuotingError(409, `Cannot modify quote in '${cpqConfig.cpqStatus}' status`)
    }

    const lineConfig = await em.findOne(CpqQuoteLineConfiguration, {
      quoteLineId: lineId,
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!lineConfig) throw new QuotingError(404, 'Quote line not found')

    const quoteLine = await em.findOne(SalesQuoteLine, {
      id: lineId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!quoteLine) throw new QuotingError(404, 'Quote line not found')

    // Load offering for context merge
    let offering: CpqProductOffering | null = null
    if (lineConfig.offeringId) {
      offering = await em.findOne(CpqProductOffering, {
        id: lineConfig.offeringId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
    }

    const mergedConfig = {
      ...(cpqConfig.quoteContext ?? {}),
      ...(offering?.designTimeValues ?? {}),
      ...update.configuration,
    }

    if (update.termMonths) {
      mergedConfig.term_months = update.termMonths
    }

    // Validate
    let validationErrors: ValidationError[] = []
    if (lineConfig.offeringId) {
      const validation = await this.validationService.validateOfferingConfiguration({
        offeringId: lineConfig.offeringId,
        configuration: update.configuration,
        scope,
      })
      validationErrors = validation.errors
    }

    // Preserve XD-250 ARC markers across edits — the UI doesn't echo them
    // back in `update.configuration`, so we'd lose `_arcMirroredFromItemId` /
    // `_arcMirroredName` (and downstream "Mirrored from existing subscription
    // item" rendering, plus the recalc / validate paths that key off them).
    const existingCfg = lineConfig.configuration as Record<string, unknown> | null
    const arcMarkers: Record<string, unknown> = {}
    if (existingCfg?._arcMirroredFromItemId !== undefined) {
      arcMarkers._arcMirroredFromItemId = existingCfg._arcMirroredFromItemId
    }
    if (existingCfg?._arcMirroredName !== undefined) {
      arcMarkers._arcMirroredName = existingCfg._arcMirroredName
    }
    update.configuration = { ...update.configuration, ...arcMarkers }
    mergedConfig._arcMirroredFromItemId = arcMarkers._arcMirroredFromItemId
    mergedConfig._arcMirroredName = arcMarkers._arcMirroredName

    // Re-price — same ARC mirror handling as recalculateInternal: skip the
    // pricing service when the line carries no offering / product (XD-250
    // mirror lines were created free-form). Without this guard, edits like
    // changing quantity wipe the synthesized charges and the line collapses
    // to "incomplete" with mrcTotal=0.
    const isArcMirrored = !!(arcMarkers._arcMirroredFromItemId)
    let charges: ResolvedCharge[]
    if (lineConfig.offeringId || lineConfig.productId) {
      charges = await this.pricingService.resolveProductCharges({
        offeringId: lineConfig.offeringId ?? undefined,
        productId: lineConfig.productId ?? undefined,
        configuration: mergedConfig,
        currencyCode: cpqConfig.currencyCode,
        ...scope,
      })
    } else {
      charges = (lineConfig.charges ?? []) as unknown as ResolvedCharge[]
    }

    const quantity = update.quantity ?? lineConfig.quantity
    const { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated } = computeLineTotals(charges, quantity, update.usageEstimates)
    const isBundleOffering = offering?.offeringType === 'bundle'
    const isConfigured =
      validationErrors.length === 0 && (charges.length > 0 || isBundleOffering || isArcMirrored)

    const endDate = computeEndDate(update.startDate ?? lineConfig.startDate?.toISOString(), update.termMonths ?? lineConfig.termMonths ?? undefined, update.endDate)

    // Update line config
    em.assign(lineConfig, {
      configuration: update.configuration,
      quantity,
      charges: charges as unknown as Array<Record<string, unknown>>,
      nrcTotal: String(nrcTotal),
      mrcTotal: String(mrcTotal),
      usageEstimates: usageEstimates ?? null,
      usageTotalEstimated: usageTotalEstimated != null ? String(usageTotalEstimated) : null,
      validationErrors: validationErrors.length > 0 ? validationErrors as unknown as Array<Record<string, unknown>> : null,
      isConfigured,
      startDate: update.startDate ? new Date(update.startDate) : lineConfig.startDate,
      termMonths: update.termMonths ?? lineConfig.termMonths,
      endDate: endDate ? new Date(endDate) : lineConfig.endDate,
    })

    // Update SalesQuoteLine totals
    const perInstanceNrc = charges.filter((c) => c.chargeType === 'nrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const perInstanceMrc = charges.filter((c) => c.chargeType === 'mrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const unitPriceNet = perInstanceNrc + perInstanceMrc

    em.assign(quoteLine, {
      quantity: String(quantity),
      unitPriceNet: String(unitPriceNet),
      unitPriceGross: String(unitPriceNet),
      totalNetAmount: String(unitPriceNet * quantity),
      totalGrossAmount: String(unitPriceNet * quantity),
      updatedAt: new Date(),
    })

    await em.flush()

    return this.recalculateInternal(em, cpqConfig, salesQuote, scope, true)
  }

  // ─── Remove Quote Item ─────────────────────────────────────────

  async removeQuoteItem(quoteId: string, lineId: string, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    if (TERMINAL_STATUSES.includes(cpqConfig.cpqStatus as CpqStatus)) {
      throw new QuotingError(409, `Cannot modify quote in '${cpqConfig.cpqStatus}' status`)
    }

    // Soft-delete the line and its children
    const lineConfig = await em.findOne(CpqQuoteLineConfiguration, {
      quoteLineId: lineId,
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!lineConfig) throw new QuotingError(404, 'Quote line not found')

    const now = new Date()
    lineConfig.deletedAt = now

    // Soft-delete children
    const children = await em.find(CpqQuoteLineConfiguration, {
      parentLineId: lineId,
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const child of children) {
      child.deletedAt = now
      // Also soft-delete the SalesQuoteLine
      const childSalesLine = await em.findOne(SalesQuoteLine, {
        id: child.quoteLineId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (childSalesLine) childSalesLine.deletedAt = now
    }

    // Soft-delete the SalesQuoteLine
    const salesLine = await em.findOne(SalesQuoteLine, {
      id: lineId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (salesLine) salesLine.deletedAt = now

    await em.flush()

    return this.recalculateInternal(em, cpqConfig, salesQuote, scope, true)
  }

  // ─── Get Quote (read from DB, no recalculation) ────────────────

  async getQuote(quoteId: string, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    const lineConfigs = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    return this.buildQuoteResult(em, cpqConfig, salesQuote, lineConfigs)
  }

  // ─── Recalculate ───────────────────────────────────────────────

  async recalculate(quoteId: string, options: { save: boolean }, scope: TenantScope): Promise<QuoteResult> {
    const em = options.save ? this.em.fork() : this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    return this.recalculateInternal(em, cpqConfig, salesQuote, scope, options.save)
  }

  // ─── Clone Quote ───────────────────────────────────────────────

  async cloneQuote(quoteId: string, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    const original = await this.loadCpqConfig(em, quoteId, scope)
    const originalQuote = await this.loadSalesQuote(em, original.quoteId, scope)

    // Generate new quote number
    const { number: quoteNumber } = await this.numberGenerator.generate({
      kind: 'quote',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    // Create new SalesQuote — assign UUID upfront
    const newSalesQuoteId = crypto.randomUUID()
    const newSalesQuote = em.create(SalesQuote, {
      id: newSalesQuoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteNumber,
      customerEntityId: originalQuote.customerEntityId,
      customerSnapshot: originalQuote.customerSnapshot,
      currencyCode: original.currencyCode,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      lineItemCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(newSalesQuote)

    // Create new CpqQuoteConfiguration
    const newCpqConfig = em.create(CpqQuoteConfiguration, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteId: newSalesQuoteId,
      customerId: original.customerId,
      cpqStatus: 'new',
      version: original.version + 1,
      parentQuoteId: original.id,
      currencyCode: original.currencyCode,
      quoteContext: original.quoteContext ? { ...original.quoteContext } : null,
      validationResult: { valid: true, errors: [] },
      pricingSummary: emptyPricingSummary(original.currencyCode),
    })
    em.persist(newCpqConfig)

    // Copy all lines
    const originalLines = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: original.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    // Map old lineId -> new lineId for parent references
    const lineIdMap = new Map<string, string>()

    for (const origLine of originalLines) {
      const origSalesLine = await em.findOne(SalesQuoteLine, {
        id: origLine.quoteLineId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      const newSalesLineId = crypto.randomUUID()
      const newSalesLine = em.create(SalesQuoteLine, {
        id: newSalesLineId,
        quote: newSalesQuote,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineNumber: origSalesLine?.lineNumber ?? 1,
        kind: origSalesLine?.kind ?? 'product',
        productId: origSalesLine?.productId ?? null,
        name: origSalesLine?.name ?? null,
        quantity: origSalesLine?.quantity ?? '1',
        unitPriceNet: origSalesLine?.unitPriceNet ?? '0',
        unitPriceGross: origSalesLine?.unitPriceGross ?? '0',
        totalNetAmount: origSalesLine?.totalNetAmount ?? '0',
        totalGrossAmount: origSalesLine?.totalGrossAmount ?? '0',
        discountAmount: origSalesLine?.discountAmount ?? '0',
        discountPercent: origSalesLine?.discountPercent ?? '0',
        taxRate: origSalesLine?.taxRate ?? '0',
        taxAmount: origSalesLine?.taxAmount ?? '0',
        currencyCode: origSalesLine?.currencyCode ?? original.currencyCode,
        configuration: origSalesLine?.configuration ?? null,
        normalizedQuantity: origSalesLine?.normalizedQuantity ?? '0',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(newSalesLine)

      lineIdMap.set(origLine.quoteLineId, newSalesLine.id)

      const newLineConfig = em.create(CpqQuoteLineConfiguration, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        quoteLineId: newSalesLine.id,
        quoteConfigurationId: newCpqConfig.id,
        offeringId: origLine.offeringId,
        productId: origLine.productId,
        specId: origLine.specId,
        action: origLine.action,
        parentLineId: null, // Will be resolved after all lines are created
        startDate: origLine.startDate,
        termMonths: origLine.termMonths,
        endDate: origLine.endDate,
        configuration: { ...origLine.configuration },
        quantity: origLine.quantity,
        charges: origLine.charges ? [...origLine.charges] : null,
        nrcTotal: origLine.nrcTotal,
        mrcTotal: origLine.mrcTotal,
        usageEstimates: origLine.usageEstimates,
        usageTotalEstimated: origLine.usageTotalEstimated,
        validationErrors: origLine.validationErrors,
        isConfigured: origLine.isConfigured,
      })
      em.persist(newLineConfig)
    }

    // Resolve parent line references
    const newLines = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: newCpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    for (const origLine of originalLines) {
      if (origLine.parentLineId) {
        const newParentLineId = lineIdMap.get(origLine.parentLineId)
        const newLine = newLines.find((l) => l.quoteLineId === lineIdMap.get(origLine.quoteLineId))
        if (newLine && newParentLineId) {
          newLine.parentLineId = newParentLineId
        }
      }
    }

    await em.flush()

    // Recalculate the new quote at current rates
    return this.recalculateInternal(em, newCpqConfig, newSalesQuote, scope, true)
  }

  // ─── Transition Status ─────────────────────────────────────────

  async transitionStatus(quoteId: string, targetStatus: string, scope: TenantScope): Promise<QuoteResult> {
    const em = this.em

    const cpqConfig = await this.loadCpqConfig(em, quoteId, scope)
    const salesQuote = await this.loadSalesQuote(em, cpqConfig.quoteId, scope)

    const currentStatus = cpqConfig.cpqStatus as CpqStatus
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []

    if (!allowed.includes(targetStatus as CpqStatus)) {
      throw new QuotingError(409, `Cannot transition from '${currentStatus}' to '${targetStatus}'`)
    }

    // XD-250 ARC: at submit-for-approval (and the no-approval shortcuts that
    // bypass it), validate ARC invariants. Spec § Services /
    // validateArcQuote: "Called automatically on the submit-for-approval
    // transition." `quoteType ?? 'new'` defends against pre-existing rows
    // (and against test stubs) that may not carry the column — we only run
    // the ARC validator when the quote is explicitly an ARC type.
    const isSubmitForApproval =
      targetStatus === 'in_approval' ||
      targetStatus === 'pre_approved' ||
      targetStatus === 'with_customer'
    const quoteType = cpqConfig.quoteType ?? 'new'
    if (isSubmitForApproval && quoteType !== 'new') {
      const validation = await this.validateArcQuote(quoteId, scope)
      if (!validation.ok) {
        throw new QuotingError(
          422,
          `ARC quote validation failed: ${validation.errors.join('; ')}`,
        )
      }
    }

    // Additional guards
    if (['in_approval', 'pre_approved', 'with_customer'].includes(targetStatus) && currentStatus === 'ready') {
      // OK — allowed from ready
    } else if (targetStatus === 'with_customer' && !['approved', 'pre_approved', 'ready'].includes(currentStatus)) {
      throw new QuotingError(422, `Quote must be in 'approved', 'pre_approved', or 'ready' status`, currentStatus)
    }

    cpqConfig.cpqStatus = targetStatus
    await em.flush()

    const lines = await this.loadLineConfigs(em, cpqConfig.id, scope)
    return this.buildQuoteResult(em, cpqConfig, salesQuote, lines)
  }

  // ─── Internal: Recalculate ─────────────────────────────────────

  private async recalculateInternal(
    em: EntityManager,
    cpqConfig: CpqQuoteConfiguration,
    salesQuote: SalesQuote,
    scope: TenantScope,
    save: boolean,
  ): Promise<QuoteResult> {
    const lineConfigs = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    let allValid = true
    const allErrors: ValidationError[] = []

    // Collect freshly computed data for each line (used for response regardless of save)
    const computedLines: Array<{
      lineConfig: CpqQuoteLineConfiguration
      charges: ResolvedCharge[]
      nrcTotal: number
      mrcTotal: number
      usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null
      usageTotalEstimated: number | null
      validationErrors: ValidationError[]
      isConfigured: boolean
    }> = []

    for (const lineConfig of lineConfigs) {
      let offering: CpqProductOffering | null = null
      if (lineConfig.offeringId) {
        offering = await em.findOne(CpqProductOffering, {
          id: lineConfig.offeringId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
      }

      const mergedConfig = {
        ...(cpqConfig.quoteContext ?? {}),
        ...(offering?.designTimeValues ?? {}),
        ...lineConfig.configuration,
      }

      if (lineConfig.termMonths) {
        mergedConfig.term_months = lineConfig.termMonths
      }

      let validationErrors: ValidationError[] = []
      if (lineConfig.offeringId) {
        const validation = await this.validationService.validateOfferingConfiguration({
          offeringId: lineConfig.offeringId,
          configuration: lineConfig.configuration,
          scope,
        })
        validationErrors = validation.errors
      }

      // ARC-mirrored lines (XD-250) carry no offering/product because the
      // source subscription item was created free-form (e.g. seeded with just
      // a name + mrcAmount). Pricing service has nothing to resolve from, so
      // skip the call and keep the synthesized / copied charges already on
      // lineConfig — otherwise quantity edits would wipe them and flip the
      // line to "incomplete".
      const cfgRecord = lineConfig.configuration as Record<string, unknown> | null
      const isArcMirrored = !!(cfgRecord?._arcMirroredFromItemId)
      let charges: ResolvedCharge[]
      if (lineConfig.offeringId || lineConfig.productId) {
        charges = await this.pricingService.resolveProductCharges({
          offeringId: lineConfig.offeringId ?? undefined,
          productId: lineConfig.productId ?? undefined,
          configuration: mergedConfig,
          currencyCode: cpqConfig.currencyCode,
          ...scope,
        })
      } else {
        charges = (lineConfig.charges ?? []) as unknown as ResolvedCharge[]
      }

      const { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated } = computeLineTotals(
        charges,
        lineConfig.quantity,
        lineConfig.usageEstimates?.map((e) => ({ chargeCode: e.chargeCode, estimatedQuantity: e.estimatedQuantity })),
      )

      const isBundleOffering = offering?.offeringType === 'bundle'
      const isConfigured =
        validationErrors.length === 0 && (charges.length > 0 || isBundleOffering || isArcMirrored)
      if (!isConfigured) allValid = false
      allErrors.push(...validationErrors)

      computedLines.push({ lineConfig, charges, nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated, validationErrors, isConfigured })

      if (save) {
        em.assign(lineConfig, {
          charges: charges as unknown as Array<Record<string, unknown>>,
          nrcTotal: String(nrcTotal),
          mrcTotal: String(mrcTotal),
          usageEstimates: usageEstimates ?? null,
          usageTotalEstimated: usageTotalEstimated != null ? String(usageTotalEstimated) : null,
          validationErrors: validationErrors.length > 0 ? validationErrors as unknown as Array<Record<string, unknown>> : null,
          isConfigured,
        })

        const salesLine = await em.findOne(SalesQuoteLine, {
          id: lineConfig.quoteLineId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        })
        if (salesLine) {
          const perInstanceNrc = charges.filter((c) => c.chargeType === 'nrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
          const perInstanceMrc = charges.filter((c) => c.chargeType === 'mrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
          const unitPriceNet = perInstanceNrc + perInstanceMrc
          em.assign(salesLine, {
            quantity: String(lineConfig.quantity),
            unitPriceNet: String(unitPriceNet),
            unitPriceGross: String(unitPriceNet),
            totalNetAmount: String(unitPriceNet * lineConfig.quantity),
            totalGrossAmount: String(unitPriceNet * lineConfig.quantity),
            updatedAt: new Date(),
          })
        }
      }
    }

    const relationshipErrors = await this.validationService.validateRelationships({
      lines: lineConfigs.map((l) => ({
        lineId: l.quoteLineId,
        specId: l.specId ?? null,
        parentLineId: l.parentLineId ?? null,
      })),
      scope,
    })
    allErrors.push(...relationshipErrors)
    if (relationshipErrors.length > 0) allValid = false

    let cpqStatus: CpqStatus
    if (lineConfigs.length === 0) {
      cpqStatus = 'new'
    } else if (!allValid) {
      cpqStatus = 'incomplete'
    } else {
      cpqStatus = 'ready'
    }

    const autoManagedStatuses: CpqStatus[] = ['new', 'incomplete', 'ready']
    if (autoManagedStatuses.includes(cpqConfig.cpqStatus as CpqStatus)) {
      cpqConfig.cpqStatus = cpqStatus
    }

    // Build pricing summary from freshly computed data (not from stale entity fields)
    const pricingSummary = computePricingSummaryFromComputed(computedLines, cpqConfig.currencyCode)

    const validationResult = { valid: allValid, errors: allErrors }

    if (save) {
      cpqConfig.validationResult = validationResult
      cpqConfig.pricingSummary = pricingSummary as unknown as Record<string, unknown>

      const grandTotal = pricingSummary.nrcTotal + pricingSummary.mrcTotal
      em.assign(salesQuote, {
        subtotalNetAmount: String(grandTotal),
        subtotalGrossAmount: String(grandTotal),
        grandTotalNetAmount: String(grandTotal),
        grandTotalGrossAmount: String(grandTotal),
        lineItemCount: lineConfigs.length,
        updatedAt: new Date(),
      })

      await em.flush()
    }

    return this.buildQuoteResultFromComputed(em, cpqConfig, salesQuote, computedLines, validationResult, pricingSummary)
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private async loadCpqConfig(em: EntityManager, quoteId: string, scope: TenantScope): Promise<CpqQuoteConfiguration> {
    // Try finding by CpqQuoteConfiguration.id first, then by quoteId
    let config = await em.findOne(CpqQuoteConfiguration, {
      id: quoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!config) {
      config = await em.findOne(CpqQuoteConfiguration, {
        quoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
    }
    if (!config) throw new QuotingError(404, 'Quote not found')
    return config
  }

  private async loadSalesQuote(em: EntityManager, quoteId: string, scope: TenantScope): Promise<SalesQuote> {
    const quote = await em.findOne(SalesQuote, {
      id: quoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (!quote) throw new QuotingError(404, 'Sales quote not found')
    return quote
  }

  private async loadLineConfigs(em: EntityManager, cpqConfigId: string, scope: TenantScope): Promise<CpqQuoteLineConfiguration[]> {
    return em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: cpqConfigId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
  }

  private async resolveOffering(
    em: EntityManager,
    item: QuoteItemInput,
    scope: TenantScope,
  ): Promise<{ offering: CpqProductOffering | null; spec: CpqProductSpecification | null }> {
    const dbScope = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }

    if (item.offeringId) {
      const offering = await em.findOne(CpqProductOffering, { id: item.offeringId, ...dbScope })
      if (!offering) throw new QuotingError(404, `Offering ${item.offeringId} not found`)
      const spec = await em.findOne(CpqProductSpecification, { id: offering.specId, ...dbScope })
      return { offering, spec }
    }

    if (item.productId) {
      const spec = await em.findOne(CpqProductSpecification, { productId: item.productId, ...dbScope })
      return { offering: null, spec }
    }

    throw new QuotingError(400, 'Either offeringId or productId is required')
  }

  private async buildQuoteResult(
    em: EntityManager,
    cpqConfig: CpqQuoteConfiguration,
    salesQuote: SalesQuote,
    lineConfigs: CpqQuoteLineConfiguration[],
    validationResult?: { valid: boolean; errors: ValidationError[] },
    pricingSummary?: PricingSummary,
  ): Promise<QuoteResult> {
    const lines: QuoteLineResult[] = []
    const arcSourceMap = await loadArcSourceMap(em, lineConfigs, cpqConfig)

    for (const lc of lineConfigs) {
      let offeringName: string | null = null
      let offeringType: string | null = null
      if (lc.offeringId) {
        const offering = await em.findOne(CpqProductOffering, {
          id: lc.offeringId,
          organizationId: cpqConfig.organizationId,
          tenantId: cpqConfig.tenantId,
        })
        if (offering) {
          offeringName = offering.name
          offeringType = offering.offeringType ?? 'simple'
        }
      }
      if (!offeringName) {
        const cfg = lc.configuration as Record<string, unknown> | null
        offeringName =
          (cfg?._arcMirroredName as string | undefined) ??
          (cfg?.offeringName as string | undefined) ??
          'Configured Item'
      }

      lines.push({
        lineId: lc.quoteLineId,
        offeringId: lc.offeringId ?? null,
        offeringName,
        offeringType,
        productId: lc.productId ?? null,
        action: lc.action,
        parentLineId: lc.parentLineId ?? null,
        quantity: lc.quantity,
        configuration: lc.configuration ?? {},
        startDate: lc.startDate?.toISOString() ?? null,
        termMonths: lc.termMonths ?? null,
        endDate: lc.endDate?.toISOString() ?? null,
        nrcTotal: Number(lc.nrcTotal),
        mrcTotal: Number(lc.mrcTotal),
        usageEstimates: lc.usageEstimates ?? null,
        usageTotalEstimated: lc.usageTotalEstimated != null ? Number(lc.usageTotalEstimated) : null,
        charges: (lc.charges ?? []) as unknown as ResolvedCharge[],
        isConfigured: lc.isConfigured,
        validationErrors: lc.validationErrors as unknown as ValidationError[] ?? null,
        arcSource: pickArcSource(lc, arcSourceMap),
        targetSubscriptionId: lc.targetSubscriptionId ?? null,
      })
    }

    const finalValidation = validationResult ?? (cpqConfig.validationResult as { valid: boolean; errors: ValidationError[] }) ?? { valid: true, errors: [] }
    const finalPricing = pricingSummary ?? computePricingSummary(lineConfigs, cpqConfig.currencyCode)

    const { customerName, convertedOrderId } = await resolveQuoteSideData(em, cpqConfig)

    return {
      id: cpqConfig.id,
      quoteId: cpqConfig.quoteId,
      quoteNumber: salesQuote.quoteNumber ?? '',
      customerId: cpqConfig.customerId,
      customerName,
      cpqStatus: cpqConfig.cpqStatus,
      version: cpqConfig.version,
      parentQuoteId: cpqConfig.parentQuoteId ?? null,
      currencyCode: cpqConfig.currencyCode,
      convertedOrderId,
      validationResult: finalValidation,
      pricingSummary: finalPricing,
      lines,
    }
  }

  /**
   * Build quote result from freshly computed line data instead of (potentially stale) entity fields.
   * Used by recalculateInternal to ensure both save:true and save:false return current prices.
   */
  private async buildQuoteResultFromComputed(
    em: EntityManager,
    cpqConfig: CpqQuoteConfiguration,
    salesQuote: SalesQuote,
    computedLines: Array<{
      lineConfig: CpqQuoteLineConfiguration
      charges: ResolvedCharge[]
      nrcTotal: number
      mrcTotal: number
      usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null
      usageTotalEstimated: number | null
      validationErrors: ValidationError[]
      isConfigured: boolean
    }>,
    validationResult: { valid: boolean; errors: ValidationError[] },
    pricingSummary: PricingSummary,
  ): Promise<QuoteResult> {
    const lines: QuoteLineResult[] = []
    const arcSourceMap = await loadArcSourceMap(
      em,
      computedLines.map((c) => c.lineConfig),
      cpqConfig,
    )

    for (const { lineConfig: lc, charges, nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated, validationErrors, isConfigured } of computedLines) {
      let offeringName: string | null = null
      let offeringType: string | null = null
      if (lc.offeringId) {
        const offering = await em.findOne(CpqProductOffering, {
          id: lc.offeringId,
          organizationId: cpqConfig.organizationId,
          tenantId: cpqConfig.tenantId,
        })
        if (offering) {
          offeringName = offering.name
          offeringType = offering.offeringType ?? 'simple'
        }
      }
      if (!offeringName) {
        const cfg = lc.configuration as Record<string, unknown> | null
        offeringName =
          (cfg?._arcMirroredName as string | undefined) ??
          (cfg?.offeringName as string | undefined) ??
          'Configured Item'
      }

      lines.push({
        lineId: lc.quoteLineId,
        offeringId: lc.offeringId ?? null,
        offeringName,
        offeringType,
        productId: lc.productId ?? null,
        action: lc.action,
        parentLineId: lc.parentLineId ?? null,
        quantity: lc.quantity,
        configuration: lc.configuration ?? {},
        startDate: lc.startDate?.toISOString() ?? null,
        termMonths: lc.termMonths ?? null,
        endDate: lc.endDate?.toISOString() ?? null,
        nrcTotal,
        mrcTotal,
        usageEstimates,
        usageTotalEstimated,
        charges,
        isConfigured,
        validationErrors: validationErrors.length > 0 ? validationErrors : null,
        arcSource: pickArcSource(lc, arcSourceMap),
        targetSubscriptionId: lc.targetSubscriptionId ?? null,
      })
    }

    const { customerName, convertedOrderId } = await resolveQuoteSideData(em, cpqConfig)

    return {
      id: cpqConfig.id,
      quoteId: cpqConfig.quoteId,
      quoteNumber: salesQuote.quoteNumber ?? '',
      customerId: cpqConfig.customerId,
      customerName,
      cpqStatus: cpqConfig.cpqStatus,
      version: cpqConfig.version,
      parentQuoteId: cpqConfig.parentQuoteId ?? null,
      currencyCode: cpqConfig.currencyCode,
      convertedOrderId,
      validationResult,
      pricingSummary,
      lines,
    }
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────

/**
 * Load the bits of `QuoteResult` that don't live on `CpqQuoteConfiguration`
 * itself: the customer display name (for header / drawer labels) and any
 * existing converted order id (locks editing in the UI).
 */
async function resolveQuoteSideData(
  em: EntityManager,
  cpqConfig: CpqQuoteConfiguration,
): Promise<{ customerName: string | null; convertedOrderId: string | null }> {
  const scope = {
    organizationId: cpqConfig.organizationId,
    tenantId: cpqConfig.tenantId,
  }

  const [customer, existingOrder] = await Promise.all([
    em.findOne(CustomerEntity, { id: cpqConfig.customerId, ...scope }),
    em.findOne(
      CpqOrderConfiguration,
      { sourceQuoteId: cpqConfig.id, ...scope, deletedAt: null },
      { fields: ['id', 'orderId'] as never },
    ),
  ])

  return {
    customerName: customer?.displayName ?? null,
    convertedOrderId: existingOrder?.orderId ?? null,
  }
}

function buildCustomerSnapshot(customer: CustomerEntity): Record<string, unknown> {
  return {
    customer: {
      id: customer.id,
      kind: customer.kind,
      displayName: customer.displayName,
      primaryEmail: customer.primaryEmail ?? null,
      primaryPhone: customer.primaryPhone ?? null,
      personProfile: customer.personProfile
        ? {
            id: customer.personProfile.id,
            firstName: customer.personProfile.firstName ?? null,
            lastName: customer.personProfile.lastName ?? null,
            preferredName: customer.personProfile.preferredName ?? null,
          }
        : null,
      companyProfile: customer.companyProfile
        ? {
            id: customer.companyProfile.id,
            legalName: customer.companyProfile.legalName ?? null,
            brandName: customer.companyProfile.brandName ?? null,
            domain: customer.companyProfile.domain ?? null,
            websiteUrl: customer.companyProfile.websiteUrl ?? null,
          }
        : null,
    },
    contact: null,
  }
}

function computeLineTotals(
  charges: ResolvedCharge[],
  quantity: number,
  usageEstimateInputs?: Array<{ chargeCode: string; estimatedQuantity: number }>,
) {
  const nrcPerInstance = charges.filter((c) => c.chargeType === 'nrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)
  const mrcPerInstance = charges.filter((c) => c.chargeType === 'mrc').reduce((s, c) => s + (c.totalPrice ?? 0), 0)

  const nrcTotal = nrcPerInstance * quantity
  const mrcTotal = mrcPerInstance * quantity

  let usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null = null
  let usageTotalEstimated: number | null = null

  if (usageEstimateInputs && usageEstimateInputs.length > 0) {
    const usageCharges = charges.filter((c) => c.chargeType === 'usage')
    usageEstimates = usageEstimateInputs.map((est) => {
      const charge = usageCharges.find((c) => c.chargeCode === est.chargeCode)
      const estimatedTotal = (charge?.unitPrice ?? 0) * est.estimatedQuantity
      return {
        chargeCode: est.chargeCode,
        estimatedQuantity: est.estimatedQuantity,
        estimatedTotal,
      }
    })
    usageTotalEstimated = usageEstimates.reduce((s, e) => s + e.estimatedTotal, 0) * quantity
  }

  return { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated }
}

function computeEndDate(startDate?: string | null, termMonths?: number, endDate?: string | null): string | null {
  if (endDate) return endDate
  if (startDate && termMonths) {
    const start = new Date(startDate)
    start.setMonth(start.getMonth() + termMonths)
    return start.toISOString().split('T')[0]
  }
  return null
}

function aggregateAdjustmentTotals(allCharges: ResolvedCharge[]): { discountTotal: number; surchargeTotal: number } {
  let discountTotal = 0
  let surchargeTotal = 0
  for (const charge of allCharges) {
    if (!charge.adjustments) continue
    for (const adj of charge.adjustments) {
      if (adj.delta < 0) {
        discountTotal += Math.abs(adj.delta) * (charge.quantity ?? 1)
      } else if (adj.delta > 0) {
        surchargeTotal += adj.delta * (charge.quantity ?? 1)
      }
    }
  }
  return { discountTotal, surchargeTotal }
}

function computePricingSummary(lineConfigs: CpqQuoteLineConfiguration[], currencyCode: string): PricingSummary {
  let nrcTotal = 0
  let mrcTotal = 0
  let usageTotalEstimated: number | null = null
  const usageCharges: PricingSummary['usageCharges'] = []
  const allCharges: ResolvedCharge[] = []

  for (const lc of lineConfigs) {
    nrcTotal += Number(lc.nrcTotal)
    mrcTotal += Number(lc.mrcTotal)
    if (lc.usageTotalEstimated != null) {
      usageTotalEstimated = (usageTotalEstimated ?? 0) + Number(lc.usageTotalEstimated)
    }

    const charges = (lc.charges ?? []) as unknown as ResolvedCharge[]
    allCharges.push(...charges)
    for (const charge of charges) {
      if (charge.chargeType === 'usage') {
        usageCharges.push({
          chargeCode: charge.chargeCode,
          chargeName: charge.chargeName,
          unitPrice: charge.unitPrice,
          note: charge.note ?? null,
        })
      }
    }
  }

  const { discountTotal, surchargeTotal } = aggregateAdjustmentTotals(allCharges)

  return {
    nrcTotal,
    mrcTotal,
    usageCharges,
    usageTotalEstimated,
    discountTotal,
    surchargeTotal,
    currencyCode,
  }
}

function computePricingSummaryFromComputed(
  computedLines: Array<{
    lineConfig: CpqQuoteLineConfiguration
    charges: ResolvedCharge[]
    nrcTotal: number
    mrcTotal: number
    usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null
    usageTotalEstimated: number | null
  }>,
  currencyCode: string,
): PricingSummary {
  let nrcTotal = 0
  let mrcTotal = 0
  let usageTotalEstimated: number | null = null
  const usageCharges: PricingSummary['usageCharges'] = []
  const allCharges: ResolvedCharge[] = []

  for (const { charges, nrcTotal: lineNrc, mrcTotal: lineMrc, usageTotalEstimated: lineUsageEst } of computedLines) {
    nrcTotal += lineNrc
    mrcTotal += lineMrc
    if (lineUsageEst != null) {
      usageTotalEstimated = (usageTotalEstimated ?? 0) + lineUsageEst
    }

    allCharges.push(...charges)
    for (const charge of charges) {
      if (charge.chargeType === 'usage') {
        usageCharges.push({
          chargeCode: charge.chargeCode,
          chargeName: charge.chargeName,
          unitPrice: charge.unitPrice,
          note: charge.note ?? null,
        })
      }
    }
  }

  const { discountTotal, surchargeTotal } = aggregateAdjustmentTotals(allCharges)

  return {
    nrcTotal,
    mrcTotal,
    usageCharges,
    usageTotalEstimated,
    discountTotal,
    surchargeTotal,
    currencyCode,
  }
}

function emptyPricingSummary(currencyCode: string): Record<string, unknown> {
  return {
    nrcTotal: 0,
    mrcTotal: 0,
    usageCharges: [],
    usageTotalEstimated: null,
    discountTotal: 0,
    surchargeTotal: 0,
    currencyCode,
  }
}

// ─── Error class ──────────────────────────────────────────────────

export class QuotingError extends Error {
  constructor(
    public status: number,
    message: string,
    public cpqStatus?: string,
    /**
     * Structured payload merged into the route's JSON response body.
     * Used to surface actionable context to the UI — e.g. the
     * `existingQuoteId` of the conflicting ARC quote on a 409 from
     * `ensureNoConcurrentArcQuote`, so the operator can be offered a
     * "Open the existing quote" confirm instead of just a dead alert.
     */
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'QuotingError'
  }
}

// ─── ARC orchestration (XD-250) ────────────────────────────────────
//
// All ARC user-journey logic lives on the CPQ Quote module:
//   • createQuoteFromSubscription — entry point from "Amend / Renew / Cancel"
//   • setQuoteType                — one-way new → arc transition
//   • attach/detach/updateTargetSubscription — manage attached targets
//   • setCancelMeta / setMergeMeta — stamp ARC-specific meta on the quote
//   • validateArcQuote             — invariants enforced before approval
//   • listTargetSubscriptions      — readonly fetch for UI
//
// The actual subscription mutations happen in cpqInventoryService.apply* at
// order activation. This service only owns the quote-level state.

export interface ArcRenewTermInput {
  newTermStart: string | Date
  newTermEnd: string | Date
  newTermMonths?: number | null
}

export interface AttachTargetInput {
  subscriptionId: string
  quoteType: Exclude<CpqQuoteType, 'new'>
  mergeAction?: MergeAction
  newTermStart?: string | Date | null
  newTermEnd?: string | Date | null
  newTermMonths?: number | null
}

export interface UpdateTargetInput {
  mergeAction?: MergeAction
  newTermStart?: string | Date | null
  newTermEnd?: string | Date | null
  newTermMonths?: number | null
}

export interface CancelMetaInput {
  reasonCode: ArcReasonCode
  reasonText?: string | null
  etfAmount?: string | number | null
  etfCurrency?: string | null
}

export interface MergeMetaInput {
  newTermStart: string | Date
  newTermEnd: string | Date
  newTermMonths?: number | null
  newSubCode?: string | null
  newSubName?: string | null
}

export interface TargetSubscriptionView {
  id: string
  subscriptionId: string
  quoteType: string
  mergeAction: string | null
  newTermStart: string | null
  newTermEnd: string | null
  newTermMonths: number | null
  subscription: {
    code: string
    name: string
    status: string
    customerId: string
    currencyCode: string
    billingCycle: string
    currentTermStart: string | null
    currentTermEnd: string | null
    termMonths: number | null
    mrcAmount: number
  } | null
}

export interface ArcQuoteValidationResult {
  ok: boolean
  errors: string[]
}

const EDITABLE_QUOTE_STATUSES: ReadonlySet<string> = new Set([
  'new',
  'incomplete',
  'ready',
])

function ensureEditable(cpqConfig: CpqQuoteConfiguration): void {
  if (!EDITABLE_QUOTE_STATUSES.has(cpqConfig.cpqStatus)) {
    throw new QuotingError(
      409,
      `Cannot modify ARC attachments — quote is in '${cpqConfig.cpqStatus}' status`,
    )
  }
}

function toDateOrNull(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  return value instanceof Date ? value : new Date(value)
}

/**
 * Render a Date / string-date value as ISO-8601. MikroORM hydrates
 * `@Property({ type: 'date' })` columns as strings (YYYY-MM-DD) on Postgres
 * — calling `.toISOString()` on them throws. This helper accepts either form.
 */
function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  // String already in ISO-ish form (YYYY-MM-DD or full ISO) — pass through.
  return String(value)
}

// ─── Module helpers extending DefaultCpqQuotingService ─────────────

declare module './cpqQuotingService' {
  interface DefaultCpqQuotingService {
    setQuoteType(quoteId: string, type: CpqQuoteType, scope: TenantScope): Promise<QuoteResult>
    createQuoteFromSubscription(input: {
      subscriptionId: string
      type: Exclude<CpqQuoteType, 'new'>
      renewTerm?: ArcRenewTermInput
    }, scope: TenantScope): Promise<{ quoteId: string; cpqConfigId: string }>
    listTargetSubscriptions(quoteId: string, scope: TenantScope): Promise<TargetSubscriptionView[]>
    attachTargetSubscription(
      quoteId: string,
      input: AttachTargetInput,
      scope: TenantScope,
    ): Promise<TargetSubscriptionView>
    detachTargetSubscription(
      quoteId: string,
      targetId: string,
      scope: TenantScope,
    ): Promise<{ ok: true }>
    updateTargetSubscription(
      quoteId: string,
      targetId: string,
      patch: UpdateTargetInput,
      scope: TenantScope,
    ): Promise<TargetSubscriptionView>
    setCancelMeta(quoteId: string, meta: CancelMetaInput, scope: TenantScope): Promise<QuoteResult>
    setMergeMeta(quoteId: string, meta: MergeMetaInput, scope: TenantScope): Promise<QuoteResult>
    validateArcQuote(quoteId: string, scope: TenantScope): Promise<ArcQuoteValidationResult>
  }
}

DefaultCpqQuotingService.prototype.setQuoteType = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  type: CpqQuoteType,
  scope: TenantScope,
): Promise<QuoteResult> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)

  if (cpqConfig.quoteType === type) {
    // No-op — caller can repeat the PATCH freely.
  } else if (cpqConfig.quoteType !== 'new') {
    throw new QuotingError(409, `Quote type is immutable (current: '${cpqConfig.quoteType}')`)
  } else if (type === 'new') {
    throw new QuotingError(400, `Cannot transition quote type back to 'new'`)
  } else {
    cpqConfig.quoteType = type
    await em.flush()
  }

  const salesQuote = await loadSalesQuoteStrict(em, cpqConfig.quoteId, scope)
  const lines = await loadLines(em, cpqConfig.id, scope)
  return (this as unknown as InternalQuoting).buildQuoteResult(em, cpqConfig, salesQuote, lines)
}

DefaultCpqQuotingService.prototype.createQuoteFromSubscription = async function (
  this: DefaultCpqQuotingService,
  input: {
    subscriptionId: string
    type: Exclude<CpqQuoteType, 'new'>
    renewTerm?: ArcRenewTermInput
  },
  scope: TenantScope,
): Promise<{ quoteId: string; cpqConfigId: string }> {
  const em = (this as unknown as { em: EntityManager }).em

  // 1. Load source subscription + active items.
  const sub = await em.findOne(CpqInventorySubscription, {
    id: input.subscriptionId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!sub) throw new QuotingError(404, 'Subscription not found')
  if (sub.status !== 'active' && sub.status !== 'suspended') {
    throw new QuotingError(
      409,
      `Subscription must be active or suspended (current: '${sub.status}')`,
    )
  }

  await ensureNoConcurrentArcQuote(em, sub.id, scope)

  const items = await em.find(CpqInventorySubscriptionItem, {
    subscriptionId: sub.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    status: { $nin: ['terminated', 'expired', 'superseded'] },
  })

  // 2. Create SalesQuote + CpqQuoteConfiguration with quoteType=type.
  const numberGenerator = (this as unknown as InternalQuoting).numberGenerator
  const { number: quoteNumber } = await numberGenerator.generate({
    kind: 'quote',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  const salesQuoteId = crypto.randomUUID()
  const salesQuote = em.create(SalesQuote, {
    id: salesQuoteId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    quoteNumber,
    customerEntityId: sub.customerId,
    currencyCode: sub.currencyCode,
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    lineItemCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never)
  em.persist(salesQuote)

  // Pre-generate id so child rows (target subscription + quote lines) can
  // reference it before flush. The DB-side `defaultRaw: 'gen_random_uuid()'`
  // only fires at INSERT, not at em.create() — so the id would be undefined
  // when CpqQuoteLineConfiguration tries to set quoteConfigurationId.
  const cpqConfigId = crypto.randomUUID()
  const cpqConfig = em.create(CpqQuoteConfiguration, {
    id: cpqConfigId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    quoteId: salesQuoteId,
    customerId: sub.customerId,
    cpqStatus: 'new',
    version: 1,
    currencyCode: sub.currencyCode,
    quoteType: input.type,
    quoteContext: { arcSourceSubscriptionId: sub.id },
    validationResult: { valid: true, errors: [] },
    pricingSummary: emptyArcPricingSummary(sub.currencyCode),
  })
  em.persist(cpqConfig)

  // 3. Attach the source subscription as the (sole) target. For renew, fall
  //    back to "renew for same length starting at current term end" so the
  //    operator can hit Convert→Activate without opening the drawer at all
  //    when the default behaviour is fine. Operator override is still
  //    available via the drawer's config-renew step.
  const renewDefaults = input.type === 'renew' ? buildRenewDefaults(sub, input.renewTerm) : null
  const target = em.create(CpqQuoteTargetSubscription, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    quoteId: cpqConfig.id,
    subscriptionId: sub.id,
    quoteType: input.type,
    mergeAction: input.type === 'renew' ? 'standalone' : null,
    newTermStart: renewDefaults?.start ?? null,
    newTermEnd: renewDefaults?.end ?? null,
    newTermMonths: renewDefaults?.months ?? null,
  })
  em.persist(target)

  // 4. Pre-fill quote lines from the subscription's active items via the
  //    shared mirror helper (also used when attaching extra targets).
  await mirrorTargetSubscriptionItems(em, cpqConfig, sub, salesQuote, input.type, scope)

  await em.flush()
  return { quoteId: salesQuoteId, cpqConfigId: cpqConfig.id }
}

DefaultCpqQuotingService.prototype.listTargetSubscriptions = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  scope: TenantScope,
): Promise<TargetSubscriptionView[]> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  const targets = await em.find(CpqQuoteTargetSubscription, {
    quoteId: cpqConfig.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (targets.length === 0) return []

  const subs = await em.find(CpqInventorySubscription, {
    id: { $in: targets.map((t) => t.subscriptionId) },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  const subMap = new Map(subs.map((s) => [s.id, s]))

  return targets.map((t) => {
    const s = subMap.get(t.subscriptionId)
    return {
      id: t.id,
      subscriptionId: t.subscriptionId,
      quoteType: t.quoteType,
      mergeAction: t.mergeAction ?? null,
      newTermStart: toIsoOrNull(t.newTermStart),
      newTermEnd: toIsoOrNull(t.newTermEnd),
      newTermMonths: t.newTermMonths ?? null,
      subscription: s
        ? {
            code: s.code,
            name: s.name,
            status: s.status,
            customerId: s.customerId,
            currencyCode: s.currencyCode,
            billingCycle: s.billingCycle,
            currentTermStart: toIsoOrNull(s.currentTermStart),
            currentTermEnd: toIsoOrNull(s.currentTermEnd),
            termMonths: s.termMonths ?? null,
            mrcAmount: Number(s.mrcAmount),
          }
        : null,
    }
  })
}

DefaultCpqQuotingService.prototype.attachTargetSubscription = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  input: AttachTargetInput,
  scope: TenantScope,
): Promise<TargetSubscriptionView> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)

  if (cpqConfig.quoteType === 'new') {
    throw new QuotingError(409, `Cannot attach a target subscription — quote_type is 'new'`)
  }
  if (cpqConfig.quoteType !== input.quoteType) {
    throw new QuotingError(
      400,
      `Quote type mismatch: quote is '${cpqConfig.quoteType}', payload says '${input.quoteType}'`,
    )
  }

  // Idempotency on (quote, subscription).
  const existing = await em.findOne(CpqQuoteTargetSubscription, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    quoteId: cpqConfig.id,
    subscriptionId: input.subscriptionId,
  })
  if (existing) {
    return mapTargetView(em, existing, scope)
  }

  // Subscription must exist and be in {active, suspended}.
  const sub = await em.findOne(CpqInventorySubscription, {
    id: input.subscriptionId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!sub) throw new QuotingError(404, 'Subscription not found')
  if (sub.status !== 'active' && sub.status !== 'suspended') {
    throw new QuotingError(
      409,
      `Subscription must be active or suspended (current: '${sub.status}')`,
    )
  }

  // Customer / currency / billingCycle must match the quote and any existing targets.
  if (sub.customerId !== cpqConfig.customerId) {
    throw new QuotingError(400, 'Subscription customer must match quote customer')
  }
  if (sub.currencyCode !== cpqConfig.currencyCode) {
    throw new QuotingError(400, 'Subscription currency must match quote currency')
  }

  const otherTargets = await em.find(CpqQuoteTargetSubscription, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    quoteId: cpqConfig.id,
  })
  if (input.quoteType === 'renew' && otherTargets.length > 0) {
    // Merge mode: every target (existing + this) must share billingCycle.
    const otherSubs = await em.find(CpqInventorySubscription, {
      id: { $in: otherTargets.map((t) => t.subscriptionId) },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const o of otherSubs) {
      if (o.billingCycle !== sub.billingCycle) {
        throw new QuotingError(
          400,
          'Merge targets must share the same billing cycle',
        )
      }
    }
  }

  await ensureNoConcurrentArcQuote(em, input.subscriptionId, scope, cpqConfig.id)

  const target = em.create(CpqQuoteTargetSubscription, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    quoteId: cpqConfig.id,
    subscriptionId: input.subscriptionId,
    quoteType: input.quoteType,
    mergeAction:
      input.quoteType === 'renew'
        ? input.mergeAction ?? (otherTargets.length === 0 ? 'standalone' : 'absorb')
        : null,
    newTermStart: toDateOrNull(input.newTermStart),
    newTermEnd: toDateOrNull(input.newTermEnd),
    newTermMonths: input.newTermMonths ?? null,
  })
  em.persist(target)
  await em.flush()

  // After attaching a 2nd renew target, retroactively flip the original
  // 'standalone' target to 'absorb' so the whole quote enters merge mode.
  let renewMergeJustEntered = false
  if (input.quoteType === 'renew') {
    const allTargets = await em.find(CpqQuoteTargetSubscription, {
      quoteId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (allTargets.length >= 2) {
      const wasStandalone = allTargets.some((t) => t.mergeAction === 'standalone')
      for (const t of allTargets) {
        t.mergeAction = 'absorb'
        t.newTermStart = null
        t.newTermEnd = null
        t.newTermMonths = null
      }
      await em.flush()
      renewMergeJustEntered = wasStandalone
    }
  }

  // XD-250 multi-target ARC: mirror the newly attached subscription's items
  // so the operator can see / edit / cancel them in the quote UI. Without
  // this the target row existed but the quote had no lines for it, so
  // activation produced an empty change-log entry on that sub. For renew
  // merge, mirrored lines carry `targetSubscriptionId: null` (the merged
  // sub doesn't exist yet at quote time) and any lines created earlier for
  // the original standalone target get re-tagged to null too.
  const salesQuote = await em.findOne(SalesQuote, {
    id: cpqConfig.quoteId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (salesQuote) {
    const isRenewMerge = input.quoteType === 'renew' && otherTargets.length > 0
    await mirrorTargetSubscriptionItems(
      em,
      cpqConfig,
      sub,
      salesQuote,
      input.quoteType,
      scope,
      { mergeMode: isRenewMerge },
    )

    if (renewMergeJustEntered) {
      const existingLines = await em.find(CpqQuoteLineConfiguration, {
        quoteConfigurationId: cpqConfig.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      for (const lc of existingLines) {
        if (lc.targetSubscriptionId !== null) lc.targetSubscriptionId = null
      }
    }

    await em.flush()
  }

  return mapTargetView(em, target, scope)
}

DefaultCpqQuotingService.prototype.detachTargetSubscription = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  targetId: string,
  scope: TenantScope,
): Promise<{ ok: true }> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)

  const target = await em.findOne(CpqQuoteTargetSubscription, {
    id: targetId,
    quoteId: cpqConfig.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!target) throw new QuotingError(404, 'Target subscription not found')

  // Drop any quote lines that pointed at this target.
  const lines = await em.find(CpqQuoteLineConfiguration, {
    quoteConfigurationId: cpqConfig.id,
    targetSubscriptionId: target.subscriptionId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  const now = new Date()
  for (const line of lines) {
    line.deletedAt = now
    const salesLine = await em.findOne(SalesQuoteLine, { id: line.quoteLineId })
    if (salesLine) salesLine.deletedAt = now
  }

  target.deletedAt = now

  // Auto-revert merge mode if only one renew target remains.
  if (target.quoteType === 'renew') {
    const remaining = await em.find(CpqQuoteTargetSubscription, {
      quoteId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      id: { $ne: target.id },
    })
    if (remaining.length === 1) {
      remaining[0].mergeAction = 'standalone'
    }
  }

  await em.flush()
  return { ok: true }
}

DefaultCpqQuotingService.prototype.updateTargetSubscription = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  targetId: string,
  patch: UpdateTargetInput,
  scope: TenantScope,
): Promise<TargetSubscriptionView> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)

  const target = await em.findOne(CpqQuoteTargetSubscription, {
    id: targetId,
    quoteId: cpqConfig.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!target) throw new QuotingError(404, 'Target subscription not found')

  if (target.quoteType !== 'renew') {
    throw new QuotingError(
      409,
      `Cannot update target on a '${target.quoteType}' quote — only renew targets carry term/merge fields`,
    )
  }

  if (patch.mergeAction !== undefined) target.mergeAction = patch.mergeAction
  if (patch.newTermStart !== undefined) target.newTermStart = toDateOrNull(patch.newTermStart)
  if (patch.newTermEnd !== undefined) target.newTermEnd = toDateOrNull(patch.newTermEnd)
  if (patch.newTermMonths !== undefined) target.newTermMonths = patch.newTermMonths ?? null

  await em.flush()
  return mapTargetView(em, target, scope)
}

DefaultCpqQuotingService.prototype.setCancelMeta = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  meta: CancelMetaInput,
  scope: TenantScope,
): Promise<QuoteResult> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)
  if (cpqConfig.quoteType !== 'cancel') {
    throw new QuotingError(
      409,
      `Cancel meta can only be set on a cancel quote (current: '${cpqConfig.quoteType}')`,
    )
  }
  cpqConfig.arcReasonCode = meta.reasonCode
  cpqConfig.arcReasonText = meta.reasonText ?? null
  cpqConfig.arcEtfAmount = meta.etfAmount != null ? String(meta.etfAmount) : null
  cpqConfig.arcEtfCurrency = meta.etfCurrency ?? cpqConfig.currencyCode
  await em.flush()

  const salesQuote = await loadSalesQuoteStrict(em, cpqConfig.quoteId, scope)
  const lines = await loadLines(em, cpqConfig.id, scope)
  return (this as unknown as InternalQuoting).buildQuoteResult(em, cpqConfig, salesQuote, lines)
}

DefaultCpqQuotingService.prototype.setMergeMeta = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  meta: MergeMetaInput,
  scope: TenantScope,
): Promise<QuoteResult> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  ensureEditable(cpqConfig)
  if (cpqConfig.quoteType !== 'renew') {
    throw new QuotingError(
      409,
      `Merge meta can only be set on a renew quote (current: '${cpqConfig.quoteType}')`,
    )
  }
  cpqConfig.arcMergeNewTermStart = toDateOrNull(meta.newTermStart)
  cpqConfig.arcMergeNewTermEnd = toDateOrNull(meta.newTermEnd)
  cpqConfig.arcMergeNewTermMonths = meta.newTermMonths ?? null
  cpqConfig.arcMergeNewSubCode = meta.newSubCode ?? null
  cpqConfig.arcMergeNewSubName = meta.newSubName ?? null
  await em.flush()

  const salesQuote = await loadSalesQuoteStrict(em, cpqConfig.quoteId, scope)
  const lines = await loadLines(em, cpqConfig.id, scope)
  return (this as unknown as InternalQuoting).buildQuoteResult(em, cpqConfig, salesQuote, lines)
}

DefaultCpqQuotingService.prototype.validateArcQuote = async function (
  this: DefaultCpqQuotingService,
  quoteId: string,
  scope: TenantScope,
): Promise<ArcQuoteValidationResult> {
  const em = (this as unknown as { em: EntityManager }).em
  const cpqConfig = await loadCpqConfigStrict(em, quoteId, scope)
  const errors: string[] = []

  if (cpqConfig.quoteType === 'new') {
    return { ok: true, errors: [] }
  }
  if (!ARC_QUOTE_TYPES.includes(cpqConfig.quoteType as Exclude<CpqQuoteType, 'new'>)) {
    errors.push(`Unknown quote type '${cpqConfig.quoteType}'`)
    return { ok: false, errors }
  }

  const targets = await em.find(CpqQuoteTargetSubscription, {
    quoteId: cpqConfig.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (targets.length === 0) {
    errors.push(`ARC quote requires at least one target subscription`)
    return { ok: false, errors }
  }

  // Fetch attached subscriptions and check status + same customer/currency/billingCycle.
  const subs = await em.find(CpqInventorySubscription, {
    id: { $in: targets.map((t) => t.subscriptionId) },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  const subMap = new Map(subs.map((s) => [s.id, s]))
  for (const t of targets) {
    const s = subMap.get(t.subscriptionId)
    if (!s) {
      errors.push(`Target subscription ${t.subscriptionId} not found`)
      continue
    }
    if (s.status !== 'active' && s.status !== 'suspended') {
      errors.push(
        `Target subscription ${s.code} must be active or suspended (current: '${s.status}')`,
      )
    }
    if (s.customerId !== cpqConfig.customerId) {
      errors.push(`Target subscription ${s.code} belongs to a different customer`)
    }
    if (s.currencyCode !== cpqConfig.currencyCode) {
      errors.push(`Target subscription ${s.code} has currency mismatch`)
    }
  }

  // Type-specific invariants.
  if (cpqConfig.quoteType === 'renew') {
    const standaloneCount = targets.filter((t) => t.mergeAction === 'standalone').length
    const absorbCount = targets.filter((t) => t.mergeAction === 'absorb').length

    if (targets.length === 1) {
      if (standaloneCount !== 1) {
        errors.push(`Single-target renew must have merge_action='standalone'`)
      }
      const t = targets[0]
      if (!t.newTermStart || !t.newTermEnd) {
        errors.push(`Standalone renew target must have newTermStart and newTermEnd`)
      } else if (t.newTermStart >= t.newTermEnd) {
        errors.push(`newTermStart must be earlier than newTermEnd`)
      }
    } else {
      if (absorbCount !== targets.length) {
        errors.push(`Multi-target renew (merge) requires every target merge_action='absorb'`)
      }
      if (
        !cpqConfig.arcMergeNewTermStart ||
        !cpqConfig.arcMergeNewTermEnd
      ) {
        errors.push(`Merge renew requires quote-level arc_merge_new_term_start and arc_merge_new_term_end`)
      } else if (cpqConfig.arcMergeNewTermStart >= cpqConfig.arcMergeNewTermEnd) {
        errors.push(`arc_merge_new_term_start must be earlier than arc_merge_new_term_end`)
      }
      // Same billing cycle across all sources.
      const cycles = new Set(
        targets
          .map((t) => subMap.get(t.subscriptionId)?.billingCycle)
          .filter(Boolean),
      )
      if (cycles.size > 1) {
        errors.push(`Merge targets must share the same billing cycle`)
      }
    }
  }

  if (cpqConfig.quoteType === 'cancel') {
    if (!cpqConfig.arcReasonCode) {
      errors.push(`Cancel quote requires arc_reason_code (call /cancel-meta first)`)
    }
  }

  // Quote line invariants.
  const lines = await loadLines(em, cpqConfig.id, scope)
  const targetSubIds = new Set(targets.map((t) => t.subscriptionId))
  const isMerge =
    cpqConfig.quoteType === 'renew' &&
    targets.length >= 2 &&
    targets.every((t) => t.mergeAction === 'absorb')

  for (const line of lines) {
    if (cpqConfig.quoteType === 'amend' || cpqConfig.quoteType === 'cancel') {
      if (!line.targetSubscriptionId) {
        errors.push(`Quote line ${line.quoteLineId} missing target_subscription_id`)
      } else if (!targetSubIds.has(line.targetSubscriptionId)) {
        errors.push(
          `Quote line ${line.quoteLineId} target_subscription_id does not match any attached target`,
        )
      }
    } else if (cpqConfig.quoteType === 'renew') {
      if (isMerge) {
        if (line.targetSubscriptionId) {
          errors.push(
            `Merge-renew line ${line.quoteLineId} must have null target_subscription_id`,
          )
        }
      } else {
        // standalone — single target.
        if (!line.targetSubscriptionId || !targetSubIds.has(line.targetSubscriptionId)) {
          errors.push(
            `Standalone renew line ${line.quoteLineId} must target the renewing subscription`,
          )
        }
      }
    }
    if (
      (line.action === 'cancel' || line.action === 'modify') &&
      cpqConfig.quoteType !== 'cancel' &&
      !line.sourceSubscriptionItemId
    ) {
      errors.push(
        `Quote line ${line.quoteLineId} action='${line.action}' requires source_subscription_item_id`,
      )
    }
  }

  // Concurrency: each attached sub must not be on another non-terminal ARC quote.
  for (const t of targets) {
    await ensureNoConcurrentArcQuoteForValidation(em, t.subscriptionId, scope, cpqConfig.id, errors)
  }

  return { ok: errors.length === 0, errors }
}

// ─── ARC private/module helpers (XD-250) ───────────────────────────

interface InternalQuoting {
  numberGenerator: SalesDocumentNumberGenerator
  buildQuoteResult: (
    em: EntityManager,
    cpqConfig: CpqQuoteConfiguration,
    salesQuote: SalesQuote,
    lineConfigs: CpqQuoteLineConfiguration[],
    validationResult?: { valid: boolean; errors: ValidationError[] },
  ) => Promise<QuoteResult>
}

async function loadCpqConfigStrict(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
): Promise<CpqQuoteConfiguration> {
  let config = await em.findOne(CpqQuoteConfiguration, {
    id: quoteId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!config) {
    config = await em.findOne(CpqQuoteConfiguration, {
      quoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
  }
  if (!config) throw new QuotingError(404, 'Quote not found')
  return config
}

async function loadSalesQuoteStrict(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
): Promise<SalesQuote> {
  const quote = await em.findOne(SalesQuote, {
    id: quoteId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!quote) throw new QuotingError(404, 'Sales quote not found')
  return quote
}

async function loadLines(
  em: EntityManager,
  cpqConfigId: string,
  scope: TenantScope,
): Promise<CpqQuoteLineConfiguration[]> {
  return em.find(CpqQuoteLineConfiguration, {
    quoteConfigurationId: cpqConfigId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
}

async function ensureNoConcurrentArcQuote(
  em: EntityManager,
  subscriptionId: string,
  scope: TenantScope,
  excludeQuoteConfigId?: string,
): Promise<void> {
  const conflicting = await em.find(CpqQuoteTargetSubscription, {
    subscriptionId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (conflicting.length === 0) return
  const cfgIds = conflicting.map((c) => c.quoteId)
  const cfgs = await em.find(CpqQuoteConfiguration, {
    id: { $in: cfgIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  for (const cfg of cfgs) {
    if (excludeQuoteConfigId && cfg.id === excludeQuoteConfigId) continue
    if (!TERMINAL_STATUSES.includes(cfg.cpqStatus as CpqStatus)) {
      throw new QuotingError(
        409,
        `Subscription has another ARC quote in progress (quoteId=${cfg.quoteId})`,
        undefined,
        // Surface the conflicting quote id so the UI can offer "Open the
        // existing quote" instead of just showing a dead-end alert. Use
        // `quoteId` (the SalesQuote UUID, what the URL bar shows after the
        // first Amend) — not `cfg.id` (the CpqQuoteConfiguration UUID) —
        // so the redirect URL matches the URL the operator would see on a
        // fresh first-time create, and so the test assertion can compare
        // the two with `toContain`.
        { existingQuoteId: cfg.quoteId, existingQuoteStatus: cfg.cpqStatus },
      )
    }
  }
}

async function ensureNoConcurrentArcQuoteForValidation(
  em: EntityManager,
  subscriptionId: string,
  scope: TenantScope,
  excludeQuoteConfigId: string,
  errors: string[],
): Promise<void> {
  try {
    await ensureNoConcurrentArcQuote(em, subscriptionId, scope, excludeQuoteConfigId)
  } catch (err) {
    if (err instanceof QuotingError) errors.push(err.message)
    else throw err
  }
}

async function mapTargetView(
  em: EntityManager,
  target: CpqQuoteTargetSubscription,
  scope: TenantScope,
): Promise<TargetSubscriptionView> {
  const sub = await em.findOne(CpqInventorySubscription, {
    id: target.subscriptionId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return {
    id: target.id,
    subscriptionId: target.subscriptionId,
    quoteType: target.quoteType,
    mergeAction: target.mergeAction ?? null,
    newTermStart: toIsoOrNull(target.newTermStart),
    newTermEnd: toIsoOrNull(target.newTermEnd),
    newTermMonths: target.newTermMonths ?? null,
    subscription: sub
      ? {
          code: sub.code,
          name: sub.name,
          status: sub.status,
          customerId: sub.customerId,
          currencyCode: sub.currencyCode,
          billingCycle: sub.billingCycle,
          currentTermStart: toIsoOrNull(sub.currentTermStart),
          currentTermEnd: toIsoOrNull(sub.currentTermEnd),
          termMonths: sub.termMonths ?? null,
          mrcAmount: Number(sub.mrcAmount),
        }
      : null,
  }
}

function emptyArcPricingSummary(currencyCode: string): Record<string, unknown> {
  return {
    nrcTotal: 0,
    mrcTotal: 0,
    usageCharges: [],
    usageTotalEstimated: null,
    discountTotal: 0,
    surchargeTotal: 0,
    currencyCode,
  }
}

// XD-250 ARC: batch-load source subscription items referenced by the lines'
// `_arcMirroredFromItemId` markers and / or `sourceSubscriptionItemId`. Used
// by buildQuoteResult / buildOrderResult to surface a "before" snapshot per
// line so the operator can compare current sub state vs. what's about to
// change. Returns a map keyed by subscription-item id.
async function loadArcSourceMap(
  em: EntityManager,
  lineConfigs: Array<{
    configuration?: Record<string, unknown> | null
    sourceSubscriptionItemId?: string | null
  }>,
  scope: { organizationId: string; tenantId: string },
): Promise<Map<string, CpqInventorySubscriptionItem>> {
  const ids = new Set<string>()
  for (const lc of lineConfigs) {
    const fromMarker = (lc.configuration as Record<string, unknown> | null)?._arcMirroredFromItemId
    if (typeof fromMarker === 'string') ids.add(fromMarker)
    if (lc.sourceSubscriptionItemId) ids.add(lc.sourceSubscriptionItemId)
  }
  if (ids.size === 0) return new Map()

  const items = await em.find(CpqInventorySubscriptionItem, {
    id: { $in: Array.from(ids) },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return new Map(items.map((it) => [it.id, it]))
}

function pickArcSource(
  lc: {
    configuration?: Record<string, unknown> | null
    sourceSubscriptionItemId?: string | null
  },
  map: Map<string, CpqInventorySubscriptionItem>,
): ArcLineSource | null {
  const fromMarker = (lc.configuration as Record<string, unknown> | null)?._arcMirroredFromItemId
  const id =
    (typeof fromMarker === 'string' ? fromMarker : null) ?? lc.sourceSubscriptionItemId ?? null
  if (!id) return null
  const item = map.get(id)
  if (!item) return null
  return {
    subscriptionItemId: item.id,
    name: item.name,
    mrcAmount: Number(item.mrcAmount),
    nrcAmount: Number(item.nrcAmount),
    quantity: item.quantity,
  }
}

// XD-250 ARC renew defaults — when the operator clicks "Renew" we pre-fill
// the target row with "same length starting at current term end" so they
// don't have to open the drawer just to confirm. Honours an explicit
// `input.renewTerm` override and falls back gracefully when the source
// subscription has missing `currentTermEnd` / `termMonths` (e.g. fixture
// data without dates) — start defaults to today and length to 12 months.
function buildRenewDefaults(
  sub: CpqInventorySubscription,
  override?: ArcRenewTermInput,
): { start: Date; end: Date; months: number } {
  if (override) {
    const start = toDateOrNull(override.newTermStart)
    const end = toDateOrNull(override.newTermEnd)
    const months = override.newTermMonths ?? null
    if (start && end && months != null) return { start, end, months }
    // Fall through to derived defaults if override was incomplete.
  }
  const months = sub.termMonths ?? 12
  const start = sub.currentTermEnd ? new Date(sub.currentTermEnd) : new Date()
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  return { start, end, months }
}

// XD-250 ARC: mirror a subscription's active items as quote lines on the
// given quote — used both at quote creation (initial target) and when the
// operator attaches additional targets via the modify-subscription drawer.
// For amend → action='modify', for cancel → action='cancel'. Preserves
// parent-child structure (bundle → components) by pre-generating SalesQuote
// line ids before the loop. No-op when the sub has no eligible items.
async function mirrorTargetSubscriptionItems(
  em: EntityManager,
  cpqConfig: CpqQuoteConfiguration,
  sub: CpqInventorySubscription,
  salesQuote: SalesQuote,
  quoteType: 'amend' | 'cancel' | 'renew',
  scope: TenantScope,
  options?: { mergeMode?: boolean },
): Promise<void> {
  const items = await em.find(CpqInventorySubscriptionItem, {
    subscriptionId: sub.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    status: { $nin: ['terminated', 'expired', 'superseded'] },
  })
  if (items.length === 0) return

  const existingLines = await em.find(SalesQuoteLine, {
    quote: salesQuote,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  let nextLineNumber = existingLines.length + 1

  const subItemIdToSalesLineId = new Map<string, string>()
  for (const item of items) {
    subItemIdToSalesLineId.set(item.id, crypto.randomUUID())
  }

  const lineAction: 'modify' | 'cancel' = quoteType === 'cancel' ? 'cancel' : 'modify'

  for (const item of items) {
    const salesLineId = subItemIdToSalesLineId.get(item.id)!
    const parentLineId = item.parentItemId
      ? subItemIdToSalesLineId.get(item.parentItemId) ?? null
      : null

    const salesLine = em.create(SalesQuoteLine, {
      id: salesLineId,
      quote: salesQuote,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      lineNumber: nextLineNumber++,
      kind: 'product',
      productId: item.productId ?? null,
      name: item.name,
      quantity: String(item.quantity),
      unitPriceNet: '0',
      unitPriceGross: '0',
      totalNetAmount: '0',
      totalGrossAmount: '0',
      discountAmount: '0',
      discountPercent: '0',
      taxRate: '0',
      taxAmount: '0',
      currencyCode: sub.currencyCode,
      configuration: item.configuration ?? null,
      normalizedQuantity: '0',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    em.persist(salesLine)

    const lineConfig = em.create(CpqQuoteLineConfiguration, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      quoteLineId: salesLineId,
      quoteConfigurationId: cpqConfig.id,
      offeringId: item.offeringId ?? null,
      productId: item.productId ?? null,
      specId: item.specId ?? null,
      action: lineAction,
      parentLineId,
      startDate: null,
      termMonths: null,
      endDate: null,
      configuration: {
        ...item.configuration,
        _arcMirroredFromItemId: item.id,
        _arcMirroredName: item.name,
      },
      quantity: item.quantity,
      charges: pickArcMirrorCharges(item, sub.currencyCode),
      nrcTotal: String(item.nrcAmount ?? 0),
      mrcTotal: String(item.mrcAmount),
      isConfigured: true,
      // XD-250 spec: merge-renew lines must have null `target_subscription_id`
      // (the source subs are absorbed into a brand-new sub at activation, so
      // there's no existing item to bind the line to). For amend / cancel /
      // standalone-renew, bind to the source sub so per-target validation /
      // groupings work.
      targetSubscriptionId: options?.mergeMode ? null : sub.id,
      sourceSubscriptionItemId: item.id,
    })
    em.persist(lineConfig)
  }
}

// XD-250 ARC: when adding a line to an ARC quote, decide which target
// subscription the line acts on. Returns null for non-ARC quotes and for
// merge-renew quotes (per validateArcQuote: merge-renew lines must have null
// target_subscription_id). For amend / cancel / standalone-renew with one
// attached target, returns that target. With multiple targets, the caller
// must pass an explicit targetSubscriptionId in QuoteItemInput.
async function resolveArcLineTargetSubscriptionId(
  em: EntityManager,
  cpqConfig: CpqQuoteConfiguration,
  scope: TenantScope,
  explicit?: string,
): Promise<string | null> {
  const quoteType = cpqConfig.quoteType ?? 'new'
  if (quoteType === 'new') return null

  const targets = await em.find(CpqQuoteTargetSubscription, {
    quoteId: cpqConfig.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (targets.length === 0) return null

  const isMerge =
    quoteType === 'renew' &&
    targets.length >= 2 &&
    targets.every((t) => t.mergeAction === 'absorb')
  if (isMerge) return null

  if (explicit) {
    if (!targets.some((t) => t.subscriptionId === explicit)) {
      throw new QuotingError(
        422,
        `targetSubscriptionId '${explicit}' is not attached to this quote`,
      )
    }
    return explicit
  }

  if (targets.length === 1) return targets[0].subscriptionId

  throw new QuotingError(
    422,
    `Quote has ${targets.length} attached targets — specify targetSubscriptionId on the line`,
  )
}

// Build the per-instance charges JSON for an ARC-mirrored quote line. If the
// source subscription item already has explicit charges, copy them. Otherwise
// synthesize a flat MRC / NRC charge from the item's stored amounts so that
// recalculate (which scales totalPrice by lineConfig.quantity) has something
// to work with — without this, changing quantity on a mirrored line wipes the
// charges array and the line flips to "incomplete".
function pickArcMirrorCharges(
  item: { mrcAmount: string | number; nrcAmount?: string | number; quantity: number; charges?: unknown },
  currencyCode: string,
): Array<Record<string, unknown>> | null {
  const existing = (item.charges ?? null) as Array<Record<string, unknown>> | null
  if (existing && existing.length > 0) return [...existing]

  const sourceQty = Math.max(1, Number(item.quantity) || 1)
  const mrc = Number(item.mrcAmount) || 0
  const nrc = Number(item.nrcAmount ?? 0) || 0
  const synth: Array<Record<string, unknown>> = []
  if (mrc > 0) {
    const perInstance = mrc / sourceQty
    synth.push({
      chargeCode: 'mrc',
      chargeName: 'Monthly Recurring',
      chargeType: 'mrc',
      pricingMethod: 'flat',
      unitPrice: perInstance,
      quantity: 1,
      totalPrice: perInstance,
      currencyCode,
    })
  }
  if (nrc > 0) {
    const perInstance = nrc / sourceQty
    synth.push({
      chargeCode: 'nrc',
      chargeName: 'Non-Recurring',
      chargeType: 'nrc',
      pricingMethod: 'flat',
      unitPrice: perInstance,
      quantity: 1,
      totalPrice: perInstance,
      currencyCode,
    })
  }
  return synth.length > 0 ? synth : null
}
