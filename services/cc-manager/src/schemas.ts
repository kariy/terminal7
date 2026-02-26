import { z } from "zod";

export const WsSessionCreateSchema = z.object({
	type: z.literal("session.create"),
	request_id: z.string().min(1).optional(),
	prompt: z.string().min(1),
	cwd: z.string().min(1).optional(),
	title: z.string().min(1).max(256).optional(),
	repo_url: z.string().url().optional(),
	repo_id: z.string().min(1).optional(),
	branch: z.string().min(1).optional(),
});

const SessionPromptBaseSchema = z.object({
	request_id: z.string().min(1).optional(),
	session_id: z.string().min(1),
	encoded_cwd: z.string().min(1),
	prompt: z.string().min(1),
	cwd: z.string().min(1).optional(),
});

export const WsSessionResumeSchema = SessionPromptBaseSchema.extend({
	type: z.literal("session.resume"),
});

export const WsSessionSendSchema = SessionPromptBaseSchema.extend({
	type: z.literal("session.send"),
});

export const WsSessionStopSchema = z.object({
	type: z.literal("session.stop"),
	request_id: z.string().min(1),
});

export const WsRefreshIndexSchema = z.object({
	type: z.literal("session.refresh_index"),
});

export const WsPingSchema = z.object({
	type: z.literal("ping"),
});

export const WsRepoListSchema = z.object({
	type: z.literal("repo.list"),
});

export const WsFileSearchSchema = z.object({
	type: z.literal("file.search"),
	request_id: z.string().min(1).optional(),
	session_id: z.string().min(1),
	encoded_cwd: z.string().min(1),
	query: z.string(),
	limit: z.number().int().min(1).max(50).optional(),
});

export const WsClientMessageSchema = z.discriminatedUnion("type", [
	WsSessionCreateSchema,
	WsSessionResumeSchema,
	WsSessionSendSchema,
	WsSessionStopSchema,
	WsRefreshIndexSchema,
	WsPingSchema,
	WsRepoListSchema,
	WsFileSearchSchema,
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
