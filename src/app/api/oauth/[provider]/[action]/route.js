import { NextResponse } from "next/server";
import {
  getProvider,
  generateAuthData,
  requestDeviceCode,
  pollForToken,
} from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";

const SUPPORTED = new Set(["codebuddy-cn"]);

function unsupported(provider) {
  return NextResponse.json(
    { error: `Provider ${provider} not supported in this build` },
    { status: 404 }
  );
}

export async function POST(request, { params }) {
  const { provider, action } = await params;
  if (!SUPPORTED.has(provider)) return unsupported(provider);

  try {
    if (action === "start") {
      const { redirectUri } = await request.json();
      const authData = await generateAuthData(provider, redirectUri);

      if (authData.flowType === "device_code") {
        const deviceResp = await requestDeviceCode(provider, authData.codeChallenge);
        return NextResponse.json({
          success: true,
          deviceCode: deviceResp.device_code,
          verificationUri: deviceResp.verification_uri,
          userCode: deviceResp.user_code,
          interval: deviceResp.interval,
          state: authData.state,
          codeVerifier: authData.codeVerifier,
        });
      }

      return NextResponse.json({ success: true, ...authData });
    }

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData } = await request.json();
      const result = await pollForToken(provider, deviceCode, codeVerifier, extraData);
      if (!result.success) {
        return NextResponse.json({
          success: false,
          pending: !!result.pending,
          error: result.error,
          errorDescription: result.errorDescription,
        });
      }
      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        ...result.tokens,
      });
      return NextResponse.json({ success: true, connection });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.log(`OAuth ${provider}/${action} failed:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(_request, { params }) {
  const { provider, action } = await params;
  if (!SUPPORTED.has(provider)) return unsupported(provider);

  if (action === "info") {
    try {
      const providerObj = getProvider(provider);
      return NextResponse.json({
        provider,
        flowType: providerObj.flowType,
        callbackPath: providerObj.callbackPath || "/callback",
      });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
