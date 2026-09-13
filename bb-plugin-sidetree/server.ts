import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { compareEntries, isInsideRoot, joinRoot, toRelative } from "./tree.js";

const entrySchema = z.object({
  name: z.string(),
  kind: z.enum(["directory", "file"]),
  relativePath: z.string(),
});
export type Entry = z.infer<typeof entrySchema>;

const rootSchema = z.object({
  environmentId: z.string(),
  hostId: z.string(),
  rootPath: z.string(),
});
export type Root = z.infer<typeof rootSchema>;

export const rpcContract = defineRpcContract({
  workspace_root: {
    input: z.object({ threadId: z.string() }),
    output: rootSchema,
  },
  list_dir: {
    input: z.object({
      threadId: z.string(),
      relativePath: z.string().max(4096).default(""),
    }),
    output: z.object({ entries: z.array(entrySchema) }),
  },
  search_files: {
    input: z.object({
      threadId: z.string(),
      query: z.string().trim().min(1).max(200),
    }),
    output: z.object({ entries: z.array(entrySchema) }),
  },
});

async function resolveRoot(bb: BbPluginApi, threadId: string): Promise<Root> {
  const thread = await bb.sdk.threads.get({ threadId });
  if (thread.environmentId === null) {
    throw new Error("This thread has no environment, so it has no files.");
  }
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  if (environment.path === null) {
    throw new Error("This thread's environment has no workspace path yet.");
  }
  return {
    environmentId: environment.id,
    hostId: environment.hostId,
    rootPath: environment.path,
  };
}

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    workspace_root: ({ threadId }) => resolveRoot(bb, threadId),

    list_dir: async ({ threadId, relativePath }) => {
      const root = await resolveRoot(bb, threadId);
      const target = joinRoot(root.rootPath, relativePath);
      if (!isInsideRoot(root.rootPath, target)) {
        throw new Error("Path is outside the workspace root.");
      }
      const listing = await bb.sdk.hosts.directory({
        hostId: root.hostId,
        path: target,
      });
      const entries = listing.entries
        .filter((entry) => entry.name !== ".git")
        .map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          relativePath: toRelative(root.rootPath, entry.path),
        }))
        .sort(compareEntries);
      return { entries };
    },

    search_files: async ({ threadId, query }) => {
      const root = await resolveRoot(bb, threadId);
      const listing = await bb.sdk.files.list({
        hostId: root.hostId,
        path: root.rootPath,
        query,
        limit: 80,
      });
      const entries = listing.files.flatMap((file) => {
        if (!isInsideRoot(root.rootPath, file.path)) return [];
        return [
          {
            name: file.name,
            kind: "file" as const,
            relativePath: toRelative(root.rootPath, file.path),
          },
        ];
      });
      return { entries };
    },
  });
}
