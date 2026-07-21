import { SharedDocumentClient } from "@/features/editor/components/shared/SharedDocumentClient";

export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedDocumentClient token={token} />;
}
