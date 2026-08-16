import type { WriteBackDeletionListing } from "@/queries/list-write-back-deletions";

interface WriteBackDeletionReader {
  listWriteBackDeletions: (userId: string, now: Date) => Promise<WriteBackDeletionListing>;
  now?: () => Date;
}

const handleGetWriteBackDeletionsRoute = async (
  context: { userId: string },
  reader: WriteBackDeletionReader,
): Promise<Response> => {
  const readNow = reader.now ?? (() => new Date());
  const { deletions, truncated } = await reader.listWriteBackDeletions(
    context.userId,
    readNow(),
  );

  return Response.json({ deletions, truncated });
};

export { handleGetWriteBackDeletionsRoute };
export type { WriteBackDeletionReader };
