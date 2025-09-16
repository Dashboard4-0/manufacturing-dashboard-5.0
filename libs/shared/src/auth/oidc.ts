import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { getConfig } from '../config';
import { logger } from '../logger';

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
}

export interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  roles?: string[];
  groups?: string[];
  permissions?: string[];
}

export interface OIDCDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
  code_challenge_methods_supported?: string[];
}

export interface OIDCTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

export class OIDCClient {
  private config: OIDCConfig;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private discoveryDocument: OIDCDiscoveryDocument | null = null;

  constructor(config?: OIDCConfig) {
    const appConfig = getConfig();
    this.config = config || {
      issuer: appConfig.OIDC_ISSUER || '',
      clientId: appConfig.OIDC_CLIENT_ID || '',
      clientSecret: appConfig.OIDC_CLIENT_SECRET,
      scope: 'openid profile email',
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.issuer) {
      logger.warn('OIDC issuer not configured, skipping initialization');
      return;
    }

    try {
      const discoveryUrl = `${this.config.issuer}/.well-known/openid-configuration`;
      const response = await fetch(discoveryUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch discovery document: ${response.statusText}`);
      }

      this.discoveryDocument = await response.json();
      this.jwks = createRemoteJWKSet(new URL(this.discoveryDocument.jwks_uri));

      logger.info({ issuer: this.config.issuer }, 'OIDC client initialized');
    } catch (error) {
      logger.error({ error, issuer: this.config.issuer }, 'Failed to initialize OIDC client');
      throw error;
    }
  }

  async verifyToken(token: string): Promise<JWTPayload> {
    if (!this.jwks) {
      throw new Error('OIDC client not initialized');
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
      });

      if (!payload.exp || payload.exp * 1000 < Date.now()) {
        throw new Error('Token expired');
      }

      if (payload.nbf && payload.nbf * 1000 > Date.now()) {
        throw new Error('Token not yet valid');
      }

      return payload;
    } catch (error) {
      logger.error({ error }, 'Token verification failed');
      throw error;
    }
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    if (!this.discoveryDocument) {
      throw new Error('OIDC client not initialized');
    }

    try {
      const response = await fetch(this.discoveryDocument.userinfo_endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.statusText}`);
      }

      const userInfo = await response.json();

      return {
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        preferred_username: userInfo.preferred_username,
        roles: userInfo.roles || [],
        groups: userInfo.groups || [],
        permissions: userInfo.permissions || [],
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch user info');
      throw error;
    }
  }

  getAuthorizationUrl(state: string, nonce?: string): string {
    if (!this.discoveryDocument) {
      throw new Error('OIDC client not initialized');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri || '',
      scope: this.config.scope || 'openid profile email',
      state,
    });

    if (nonce) {
      params.append('nonce', nonce);
    }

    return `${this.discoveryDocument.authorization_endpoint}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, codeVerifier?: string): Promise<OIDCTokenResponse> {
    if (!this.discoveryDocument) {
      throw new Error('OIDC client not initialized');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri || '',
    });

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    if (codeVerifier) {
      params.append('code_verifier', codeVerifier);
    }

    try {
      const response = await fetch(this.discoveryDocument.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error({ error }, 'Failed to exchange code for token');
      throw error;
    }
  }

  async refreshToken(refreshToken: string): Promise<OIDCTokenResponse> {
    if (!this.discoveryDocument) {
      throw new Error('OIDC client not initialized');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    try {
      const response = await fetch(this.discoveryDocument.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error({ error }, 'Failed to refresh token');
      throw error;
    }
  }

  async revokeToken(token: string, tokenType: 'access_token' | 'refresh_token' = 'access_token'): Promise<void> {
    if (!this.discoveryDocument?.revocation_endpoint) {
      logger.warn('Token revocation endpoint not available');
      return;
    }

    const params = new URLSearchParams({
      token,
      token_type_hint: tokenType,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      params.append('client_secret', this.config.clientSecret);
    }

    try {
      const response = await fetch(this.discoveryDocument.revocation_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Token revocation failed');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to revoke token');
    }
  }
}

let defaultClient: OIDCClient | null = null;

export async function getOIDCClient(): Promise<OIDCClient> {
  if (!defaultClient) {
    defaultClient = new OIDCClient();
    await defaultClient.initialize();
  }
  return defaultClient;
}