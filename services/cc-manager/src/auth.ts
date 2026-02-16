import { ManagerRepository } from "./repository";
import type { DeviceRecord } from "./types";

export class AuthService {
	constructor(private readonly repository: ManagerRepository) {}

	extractBearerToken(req: Request): string | null {
		const header = req.headers.get("authorization");
		if (!header) return null;
		const [scheme, value] = header.split(" ");
		if (!scheme || !value) return null;
		if (scheme.toLowerCase() !== "bearer") return null;
		return value.trim();
	}

	authenticateRequest(req: Request): DeviceRecord | null {
		const token = this.extractBearerToken(req);
		if (!token) return null;
		return this.repository.authenticateAccessToken(token);
	}

	authenticateToken(token: string): DeviceRecord | null {
		return this.repository.authenticateAccessToken(token);
	}
}
