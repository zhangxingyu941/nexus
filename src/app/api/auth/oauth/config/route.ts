import { NextResponse } from "next/server";
import { getOAuthProviderConfiguration } from "./handlers";

export function GET() {
  return NextResponse.json(getOAuthProviderConfiguration());
}
