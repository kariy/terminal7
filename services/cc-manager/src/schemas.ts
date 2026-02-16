import { z } from "zod";

export const RegisterDeviceBodySchema = z.object({
	device_name: z.string().min(1).max(128).optional(),
	bootstrap_nonce: z.string().min(1).optional(),
});

export const WsAuthInitSchema = z.object({
	type: z.literal("auth.init"),
	token: z.string().min(1),
});

export const WsSessionCreateSchema = z.object({
	type: z.literal("session.create"),
	request_id: z.string().min(1).optional(),
	prompt: z.string().min(1),
	cwd: z.string().min(1).optional(),
	title: z.string().min(1).max(256).optional(),
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

export const WsClientMessageSchema = z.discriminatedUnion("type", [
	WsAuthInitSchema,
	WsSessionCreateSchema,
	WsSessionResumeSchema,
	WsSessionSendSchema,
	WsSessionStopSchema,
	WsRefreshIndexSchema,
	WsPingSchema,
]);

export type RegisterDeviceBody = z.infer<typeof RegisterDeviceBodySchema>;
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
