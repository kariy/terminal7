/**
 * CLI tool for managing auth users.
 *
 * Usage:
 *   bun run services/cc-manager/src/manage-users.ts add <username> <password>
 *   bun run services/cc-manager/src/manage-users.ts list
 *   bun run services/cc-manager/src/manage-users.ts delete <username>
 *   bun run services/cc-manager/src/manage-users.ts passwd <username> <new-password>
 */

import { loadConfig } from "./config";
import { ManagerRepository } from "./repository";
import { hashPassword, validatePassword } from "./auth";

const config = loadConfig();
const repository = new ManagerRepository(config.dbPath);

const [command, ...args] = process.argv.slice(2);

async function main() {
	switch (command) {
		case "add": {
			const [username, password] = args;
			if (!username || !password) {
				console.error("Usage: manage-users add <username> <password>");
				process.exit(1);
			}
			const pwCheck = validatePassword(password);
			if (!pwCheck.valid) {
				console.error(`Invalid password: ${pwCheck.message}`);
				process.exit(1);
			}
			const existing = repository.getAuthUserByUsername(username);
			if (existing) {
				console.error(`User "${username}" already exists.`);
				process.exit(1);
			}
			const passwordHash = await hashPassword(password);
			const user = repository.createAuthUser({
				id: crypto.randomUUID(),
				username,
				passwordHash,
			});
			console.log(`Created user "${user.username}" (id: ${user.id})`);
			break;
		}

		case "list": {
			const users = repository.listAuthUsers();
			if (users.length === 0) {
				console.log("No users configured.");
			} else {
				console.log(`${users.length} user(s):`);
				for (const u of users) {
					console.log(
						`  ${u.username} (id: ${u.id}, created: ${new Date(u.createdAt).toISOString()})`,
					);
				}
			}
			break;
		}

		case "delete": {
			const [username] = args;
			if (!username) {
				console.error("Usage: manage-users delete <username>");
				process.exit(1);
			}
			const user = repository.getAuthUserByUsername(username);
			if (!user) {
				console.error(`User "${username}" not found.`);
				process.exit(1);
			}
			repository.deleteAuthUser(user.id);
			console.log(`Deleted user "${username}".`);
			break;
		}

		case "passwd": {
			const [username, newPassword] = args;
			if (!username || !newPassword) {
				console.error(
					"Usage: manage-users passwd <username> <new-password>",
				);
				process.exit(1);
			}
			const pwCheck2 = validatePassword(newPassword);
			if (!pwCheck2.valid) {
				console.error(`Invalid password: ${pwCheck2.message}`);
				process.exit(1);
			}
			const user = repository.getAuthUserByUsername(username);
			if (!user) {
				console.error(`User "${username}" not found.`);
				process.exit(1);
			}
			const passwordHash = await hashPassword(newPassword);
			repository.updateAuthUserPassword(user.id, passwordHash);
			console.log(`Password updated for "${username}".`);
			break;
		}

		default:
			console.error(
				"Usage: manage-users <add|list|delete|passwd> [args...]",
			);
			process.exit(1);
	}

	repository.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
