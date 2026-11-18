import cliCommands from '../cli'

const command = cliCommands.find((entry) => entry.command === 'run-cost-expiry')!
const env = process.env as Record<string, string | undefined>

describe('cpq run-cost-expiry CLI', () => {
  const original = env.NODE_ENV
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined); process.exitCode = undefined })
  afterEach(() => { env.NODE_ENV = original; jest.restoreAllMocks(); process.exitCode = undefined })

  it('is registered', () => {
    expect(command).toBeDefined()
  })

  it('refuses --today in production without --dry-run (before touching the container)', async () => {
    env.NODE_ENV = 'production'
    await command.run(['--today', '2026-12-01'])
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--today is refused in production'))
  })

  it('rejects a malformed --today', async () => {
    env.NODE_ENV = 'test'
    await command.run(['--today', '01/12/2026'])
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('YYYY-MM-DD'))
  })
})
