export function jsonResponse(
	status: number,
	payload: unknown,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...headers,
		},
	});
}

export async function safeJson(req: Request): Promise<unknown | null> {
	try {
		return await req.json();
	} catch {
		return null;
	}
}

export function notFound(): Response {
	return jsonResponse(404, {
		error: {
			code: "not_found",
			message: "Not found",
		},
	});
}

export function unauthorized(message = "Unauthorized"): Response {
	return jsonResponse(401, {
		error: {
			code: "unauthorized",
			message,
		},
	});
}

export function badRequest(message: string, details?: unknown): Response {
	return jsonResponse(400, {
		error: {
			code: "bad_request",
			message,
			details,
		},
	});
}
