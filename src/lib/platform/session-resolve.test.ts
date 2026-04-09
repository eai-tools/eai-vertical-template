import {
  getRoutingRedirectUrl,
  resolvePublicApiBaseUrl,
} from '@/lib/platform/session-resolve';

const originalEnv = process.env;

describe('resolvePublicApiBaseUrl', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ROUTING_BOOTSTRAP_PUBLIC_API_URL = 'https://api.au.myenterprise.ai';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetAllMocks();
  });

  it('returns fallback base URL when no user token is available', async () => {
    const result = await resolvePublicApiBaseUrl({
      accessToken: null,
      fallbackBaseUrl: 'https://test-api.ae.myenterprise.ai',
      product: 'vertical-template',
    });

    expect(result.baseUrl).toBe('https://test-api.ae.myenterprise.ai');
    expect(result.routing).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns resolved regional API base URL for authenticated users', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'resolved',
        userId: 'user-123',
        product: 'vertical-template',
        productAllowed: true,
        apiBaseUrl: 'https://api.eu.myenterprise.ai',
        appBaseUrl: null,
        routingMode: 'api_only',
      }),
    });

    const result = await resolvePublicApiBaseUrl({
      accessToken: 'user-token',
      fallbackBaseUrl: 'https://test-api.ae.myenterprise.ai',
      product: 'vertical-template',
      currentAppHost: 'localhost:3000',
      requestedTenantId: 'tenant-eu',
    });

    expect(result.baseUrl).toBe('https://api.eu.myenterprise.ai');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.au.myenterprise.ai/v3/session/resolve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer user-token',
        }),
      }),
    );
  });

  it('throws RoutingResolutionError when tenant selection is required', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'selection_required',
        userId: 'user-123',
        product: 'vertical-template',
        productAllowed: false,
        apiBaseUrl: null,
        appBaseUrl: null,
        routingMode: 'selection_required',
        reason: 'tenant_selection_required',
        candidateTenants: [
          {
            id: 'tenant-eu',
            slug: 'tenant-eu',
            displayName: 'Tenant EU',
            depth: 2,
            role: 'tenant-viewer',
            createdAt: '2026-04-08T00:00:00Z',
            homeRegion: 'eu',
          },
        ],
      }),
    });

    try {
      await resolvePublicApiBaseUrl({
        accessToken: 'user-token',
        fallbackBaseUrl: 'https://test-api.ae.myenterprise.ai',
        product: 'vertical-template',
      });
      throw new Error('Expected RoutingResolutionError to be thrown');
    } catch (error) {
      expect(error).toHaveProperty('statusCode', 409);
      expect(error).toHaveProperty('responseBody.candidateTenants.0.id', 'tenant-eu');
    }
  });

  it('throws RoutingResolutionError when routing is blocked', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'blocked',
        userId: 'user-123',
        product: 'vertical-template',
        productAllowed: false,
        apiBaseUrl: null,
        appBaseUrl: null,
        routingMode: 'blocked',
        reason: 'tenant_region_unresolved',
      }),
    });

    await expect(
      resolvePublicApiBaseUrl({
        accessToken: 'user-token',
        fallbackBaseUrl: 'https://test-api.ae.myenterprise.ai',
        product: 'vertical-template',
      }),
    ).rejects.toHaveProperty('statusCode', 403);
  });

  it('returns redirect URL when routing resolves to redirect mode', () => {
    expect(
      getRoutingRedirectUrl({
        status: 'resolved',
        userId: 'user-123',
        product: 'vertical-template',
        productAllowed: true,
        apiBaseUrl: 'https://api.eu.myenterprise.ai',
        appBaseUrl: 'https://vertical.eu.myenterprise.ai/',
        routingMode: 'redirect',
        currentHostMatchesTarget: false,
      }),
    ).toBe('https://vertical.eu.myenterprise.ai');
  });

  it('returns null when routing does not require redirect', () => {
    expect(
      getRoutingRedirectUrl({
        status: 'resolved',
        userId: 'user-123',
        product: 'vertical-template',
        productAllowed: true,
        apiBaseUrl: 'https://api.eu.myenterprise.ai',
        appBaseUrl: null,
        routingMode: 'api_only',
        currentHostMatchesTarget: null,
      }),
    ).toBeNull();
  });
});
