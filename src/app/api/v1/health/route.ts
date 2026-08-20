import { apiFailure, apiSuccess } from "@/lib/api/response";
import { resolveRequestId } from "@/lib/api/request-id";
import { APP_VERSION } from "@/lib/version";

export function GET(request: Request): Response {
  const requestId = resolveRequestId(request);
  try {
    return apiSuccess(
      { status: "ok", version: APP_VERSION },
      { requestId },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
