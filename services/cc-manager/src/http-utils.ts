export function jsonResponse(
	status: number,
	payload: unknown,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"Referrer-Policy": "no-referrer",
			...headers,
		},
	});
}

export function notFound(): Response {
	return jsonResponse(404, {
		error: {
			code: "not_found",
			message: "Not found",
		},
	});
}
