// lib/utils/edgeFunctionError.ts
import { getErrorMessage } from './alert';

/** What to tell the user when a Supabase Edge Function call (bill scan, voice entry) fails.
 *
 * - FunctionsFetchError: the request never got an answer. Calling a function that is not deployed on the
 *   project ends up here too (its 404 carries no CORS headers, so the browser drops it), which is why the raw
 *   text "Failed to send a request to the Edge Function" says nothing useful.
 * - FunctionsHttpError: the function answered with an error (not set up, over the daily limit, bad photo ...)
 *   and put the reason in its JSON body, which the library does not unpack by itself. */
export async function edgeFunctionErrorText(error: unknown, feature: string): Promise<string> {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'FunctionsFetchError') {
    return `${feature} is not switched on for this account yet, so it cannot be used right now. You can still fill the entry in by hand.`;
  }
  if (name === 'FunctionsHttpError') {
    try {
      const body = await (error as { context: Response }).context.json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // the body was not JSON - fall through to the generic text
    }
  }
  return getErrorMessage(error, 'Please try again or fill it in by hand.');
}
