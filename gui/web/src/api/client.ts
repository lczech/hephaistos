// The Server's API, typed from its schema (`openapi.json`).

import createClient, { type Middleware } from "openapi-fetch";
import { forgetToken, token } from "../token";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

/** An answer other than success, with the Server's message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
  onResponse({ response }) {
    if (response.status === 401) forgetToken();
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
  const message =
    typeof error === "object" && error !== null && "error" in error
      ? String(error.error)
      : `${response.status} ${response.statusText}`;
  throw new ApiError(response.status, message);
}
