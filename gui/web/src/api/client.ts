// The Server's API, typed from its schema (`openapi.json`).

import createClient, { type Middleware } from "openapi-fetch";
import { forgetToken, token } from "../token";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

/** An answer other than success, with the Server's message, and the Checkout it is about. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly checkout: Schemas["ErrorCheckoutJson"] | null = null,
  ) {
    super(message);
  }
}

const auth: Middleware = {
  onRequest({ request }) {
    const value = token();
    if (value !== null) request.headers.set("Authorization", `Bearer ${value}`);
    return request;
  },
  onResponse({ request, response }) {
    const sent = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
    if (response.status === 401) forgetToken(sent);
    return response;
  },
};

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  fetch: (request) => globalThis.fetch(request), // looked up at each call, so tests can stand in
});
api.use(auth);

/** The data of a successful answer; throws ApiError for any other. */
export function unwrap<T>(answer: { data?: T; error?: unknown; response: Response }): T {
  if (answer.data !== undefined) return answer.data;
  const { error, response } = answer;
  // Ours as the schema says, unless something else answered, e.g. a proxy.
  const ours = typeof error === "object" && error !== null && "error" in error ? error : undefined;
  const message = ours ? String(ours.error) : `${response.status} ${response.statusText}`;
  const checkout = ours && "checkout" in ours ? (ours as Schemas["ErrorJson"]).checkout : null;
  throw new ApiError(response.status, message, checkout);
}
