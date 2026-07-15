import { NextResponse } from "next/server";
import {
  AUTH_CREDENTIAL_PURPOSES,
  type AuthCredentialChallengeResponse,
  type AuthCredentialPurpose,
} from "../../../../shared/authCredential";
import { AuthCredentialError } from "../../../../server/authCredentialService";
import { parseAuthJson } from "../authRequest";
import {
  authCredentialErrorResponse,
  authCredentialServiceUnavailableResponse,
} from "../authCredentialResponse";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../authSecurity";

interface CredentialChallengeService {
  issueChallenge(
    purpose: AuthCredentialPurpose,
  ): Promise<AuthCredentialChallengeResponse>;
}

export function createCredentialChallengeRouteHandler({
  credentials,
  security,
}: {
  credentials: CredentialChallengeService;
  security: RouteAuthSecurity;
}) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return withNoStore(payload);
    }

    if (!isCredentialChallengePayload(payload)) {
      return withNoStore(authCredentialErrorResponse(
        new AuthCredentialError("credential_invalid"),
      )!);
    }

    const limitedResponse = await enforceAuthRateLimit(
      security,
      request,
      "credential-challenge",
      "",
    );
    if (limitedResponse) {
      return withNoStore(limitedResponse);
    }

    try {
      const challenge = await credentials.issueChallenge(payload.purpose);
      return withNoStore(NextResponse.json(challenge));
    } catch (error) {
      return withNoStore(
        authCredentialErrorResponse(error)
          ?? authCredentialServiceUnavailableResponse(),
      );
    }
  };
}

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isCredentialChallengePayload(
  payload: Record<string, unknown>,
): payload is { purpose: AuthCredentialPurpose } {
  return Object.keys(payload).length === 1
    && Object.prototype.hasOwnProperty.call(payload, "purpose")
    && typeof payload.purpose === "string"
    && AUTH_CREDENTIAL_PURPOSES.some((purpose) => purpose === payload.purpose);
}
