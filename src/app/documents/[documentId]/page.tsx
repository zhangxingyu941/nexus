import { DocumentRouteClient } from "./DocumentRouteClient";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return <DocumentRouteClient publicId={documentId} />;
}
