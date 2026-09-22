// packages/core/src/http/index.ts

import { HttpMethod } from '../types/index.js';

export interface HttpResponse<T = any> {
  status: number;
  ok: boolean;
  data: T;
  headers: Record<string, string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  globalHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export class ApiClient {
  private baseUrl: string;
  private globalHeaders: Record<string, string>;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, ''); // Strip trailing slash
    this.globalHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.globalHeaders,
    };
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  /**
   * Builds the complete URL by combining baseUrl and endpoint.
   * If endpoint is an absolute URL (starts with http:// or https://), baseUrl is not prepended.
   */
  public buildUrl(endpoint: string, params?: Record<string, any>): string {
    let url: URL;
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      url = new URL(endpoint);
    } else {
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      url = new URL(`${this.baseUrl}${cleanEndpoint}`);
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Executes a fetch request with timeout, retries, status check, and FormData support.
   */
  public async request<T = any>(
    method: HttpMethod,
    endpoint: string,
    options?: {
      params?: Record<string, any>;
      body?: any;
      headers?: Record<string, string>;
      retries?: number;
      expectedStatus?: number | number[];
    }
  ): Promise<HttpResponse<T>> {
    const url = this.buildUrl(endpoint, options?.params);

    const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
    const headers: Record<string, string> = {
      ...this.globalHeaders,
      ...options?.headers,
    };

    // For multipart/form-data, let fetch set the boundary automatically
    if (isFormData) {
      delete headers['Content-Type'];
      delete headers['content-type'];
    }

    const maxAttempts = (options?.retries ?? this.maxRetries) + 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };

        if (options?.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          if (isFormData) {
            fetchOptions.body = options.body;
          } else if (typeof options.body === 'string') {
            fetchOptions.body = options.body;
          } else {
            fetchOptions.body = JSON.stringify(options.body);
          }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          responseHeaders[key] = val;
        });

        let responseData: any = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            responseData = await response.json();
          } catch {
            responseData = null;
          }
        } else {
          responseData = await response.text();
        }

        let isOk = response.ok;
        if (options?.expectedStatus !== undefined) {
          const expected = Array.isArray(options.expectedStatus)
            ? options.expectedStatus
            : [options.expectedStatus];
          isOk = expected.includes(response.status);
        }

        return {
          status: response.status,
          ok: isOk,
          data: responseData,
          headers: responseHeaders,
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        // If aborted due to timeout or network error, retry if attempts remain
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
      }
    }

    throw lastError || new Error(`Request to ${url} failed after ${maxAttempts} attempts`);
  }

  /**
   * Helper to perform a GET lookup query.
   */
  public async getEntity(
    endpoint: string,
    params?: Record<string, any>,
    headers?: Record<string, string>,
    expectedStatus?: number | number[]
  ): Promise<HttpResponse> {
    return this.request('GET', endpoint, { params, headers, expectedStatus });
  }

  /**
   * Helper to create an entity via POST.
   */
  public async createEntity(
    endpoint: string,
    body: any,
    headers?: Record<string, string>,
    expectedStatus?: number | number[]
  ): Promise<HttpResponse> {
    return this.request('POST', endpoint, { body, headers, expectedStatus });
  }

  /**
   * Helper to update an entity via PUT or PATCH.
   */
  public async updateEntity(
    endpoint: string,
    body: any,
    method: 'PUT' | 'PATCH' = 'PUT',
    headers?: Record<string, string>,
    expectedStatus?: number | number[]
  ): Promise<HttpResponse> {
    return this.request(method, endpoint, { body, headers, expectedStatus });
  }

  /**
   * Helper to delete or soft-delete an entity.
   */
  public async deleteEntity(
    endpoint: string,
    options?: {
      method?: 'DELETE' | 'PUT' | 'PATCH' | 'POST';
      body?: any;
      headers?: Record<string, string>;
      expectedStatus?: number | number[];
    }
  ): Promise<HttpResponse> {
    return this.request(options?.method || 'DELETE', endpoint, {
      body: options?.body,
      headers: options?.headers,
      expectedStatus: options?.expectedStatus,
    });
  }

  /**
   * Extracts an entity object from an API response based on optional data path.
   */
  public extractEntity(
    responseData: any,
    options?: { response_data_path?: string; response_id_field?: string }
  ): any {
    if (!responseData) return null;

    let target = responseData;

    // Navigate data path if specified (e.g. "data" or "results.items")
    if (options?.response_data_path) {
      const parts = options.response_data_path.split('.');
      for (const part of parts) {
        if (target && typeof target === 'object' && part in target) {
          target = target[part];
        } else {
          return null;
        }
      }
    }

    // If target is an array, take the first element
    if (Array.isArray(target)) {
      return target.length > 0 ? target[0] : null;
    }

    return typeof target === 'object' ? target : null;
  }

  /**
   * Extracts the identifier (ID or URL) from an entity or response object.
   * Supports dot notation (e.g. 'data.url' or 'upload.file_id').
   */
  public extractId(entity: any, idField: string = 'id'): string | undefined {
    if (!entity || typeof entity !== 'object') return undefined;

    // Support dot-notation (e.g., 'data.url' or 'media.url')
    if (idField.includes('.')) {
      const parts = idField.split('.');
      let current: any = entity;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          current = undefined;
          break;
        }
      }
      if (current !== undefined && current !== null) {
        return String(current);
      }
    }

    // Try primary id field
    if (idField in entity && entity[idField] !== undefined && entity[idField] !== null) {
      return String(entity[idField]);
    }

    // Try common fallback conventions
    const fallbacks = ['id', '_id', 'uuid', 'code', 'id_key', 'identifier', 'url', 'public_url'];
    for (const key of fallbacks) {
      if (key in entity && entity[key] !== undefined && entity[key] !== null) {
        return String(entity[key]);
      }
    }

    return undefined;
  }
}
