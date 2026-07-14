import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../server/database/pool";
import { createFileWorkspaceStore } from "../../../server/workspaceStore";
import { createWorkspaceRouteHandlers, parseWorkspaceRequest } from "./handlers";

export async function GET(request: Request) {
  if (hasDatabaseConfiguration()) {
    return createWorkspaceRouteHandlers(createPostgresServices()).GET(request);
  }

  const store = createFileWorkspaceStore();

  return NextResponse.json({
    workspace: await store.loadWorkspace(),
  });
}

export async function PUT(request: Request) {
  if (hasDatabaseConfiguration()) {
    return createWorkspaceRouteHandlers(createPostgresServices()).PUT(request);
  }

  const workspaceResult = await parseWorkspaceRequest(request);
  if (workspaceResult instanceof NextResponse) {
    return workspaceResult;
  }

  const store = createFileWorkspaceStore();

  return NextResponse.json({
    saved: true,
    workspace: await store.saveWorkspace(workspaceResult),
  });
}
