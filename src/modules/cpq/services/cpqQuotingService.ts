import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import {
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
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
} from './types'
import { ALLOWED_TRANSITIONS, TERMINAL_STATUSES, getBaseCurrencyCode } from './types'

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

    // Re-price
    const charges = await this.pricingService.resolveProductCharges({
      offeringId: lineConfig.offeringId ?? undefined,
      productId: lineConfig.productId ?? undefined,
      configuration: mergedConfig,
      currencyCode: cpqConfig.currencyCode,
      ...scope,
    })

    const quantity = update.quantity ?? lineConfig.quantity
    const { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated } = computeLineTotals(charges, quantity, update.usageEstimates)
    const isBundleOffering = offering?.offeringType === 'bundle'
    const isConfigured = validationErrors.length === 0 && (charges.length > 0 || isBundleOffering)

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

      const charges = await this.pricingService.resolveProductCharges({
        offeringId: lineConfig.offeringId ?? undefined,
        productId: lineConfig.productId ?? undefined,
        configuration: mergedConfig,
        currencyCode: cpqConfig.currencyCode,
        ...scope,
      })

      const { nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated } = computeLineTotals(
        charges,
        lineConfig.quantity,
        lineConfig.usageEstimates?.map((e) => ({ chargeCode: e.chargeCode, estimatedQuantity: e.estimatedQuantity })),
      )

      const isBundleOffering = offering?.offeringType === 'bundle'
      const isConfigured = validationErrors.length === 0 && (charges.length > 0 || isBundleOffering)
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

    for (const lc of lineConfigs) {
      let offeringName = 'Configured Item'
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
      })
    }

    const finalValidation = validationResult ?? (cpqConfig.validationResult as { valid: boolean; errors: ValidationError[] }) ?? { valid: true, errors: [] }
    const finalPricing = pricingSummary ?? computePricingSummary(lineConfigs, cpqConfig.currencyCode)

    return {
      id: cpqConfig.id,
      quoteId: cpqConfig.quoteId,
      quoteNumber: salesQuote.quoteNumber ?? '',
      customerId: cpqConfig.customerId,
      cpqStatus: cpqConfig.cpqStatus,
      version: cpqConfig.version,
      parentQuoteId: cpqConfig.parentQuoteId ?? null,
      currencyCode: cpqConfig.currencyCode,
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

    for (const { lineConfig: lc, charges, nrcTotal, mrcTotal, usageEstimates, usageTotalEstimated, validationErrors, isConfigured } of computedLines) {
      let offeringName = 'Configured Item'
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
      })
    }

    return {
      id: cpqConfig.id,
      quoteId: cpqConfig.quoteId,
      quoteNumber: salesQuote.quoteNumber ?? '',
      customerId: cpqConfig.customerId,
      cpqStatus: cpqConfig.cpqStatus,
      version: cpqConfig.version,
      parentQuoteId: cpqConfig.parentQuoteId ?? null,
      currencyCode: cpqConfig.currencyCode,
      validationResult,
      pricingSummary,
      lines,
    }
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────

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
  ) {
    super(message)
    this.name = 'QuotingError'
  }
}
