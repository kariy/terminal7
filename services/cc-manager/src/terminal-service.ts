import { log } from "./logger";

export interface TerminalHandle {
	write(data: Buffer | string): void;
	resize(cols: number, rows: number): void;
	close(): void;
}

export interface TerminalOpenParams {
	sshDestination: string;
	remoteCommand: string;
	cols: number;
	rows: number;
	onData: (data: Buffer) => void;
	onExit: (code: number | null) => void;
}

export interface TerminalServiceLike {
	open(params: TerminalOpenParams): TerminalHandle;
}

export class TerminalService implements TerminalServiceLike {
	open(params: TerminalOpenParams): TerminalHandle {
		const { sshDestination, remoteCommand, cols, rows, onData, onExit } = params;

		// Wrap SSH in Python's pty.spawn() to get a real PTY, enabling
		// password prompts and proper terminal behavior. Unlike `script`,
		// Python gracefully handles a non-TTY stdin.
		const sizeSetup = `stty rows ${rows} cols ${cols} 2>/dev/null;`;
		const fullCommand = `${sizeSetup} ${remoteCommand}`;

		const sshArgs = ["ssh", "-t", "-o", "StrictHostKeyChecking=accept-new", sshDestination, fullCommand];
		const args = [
			"python3", "-c", "import pty,sys; pty.spawn(sys.argv[1:])",
			...sshArgs,
		];

		log.terminal(`spawning: ${args.join(" ")}`);
		log.terminal(`remote command: ${remoteCommand}`);

		let proc: ReturnType<typeof Bun.spawn>;
		try {
			proc = Bun.spawn(args, {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, TERM: "xterm-256color" },
			});
			log.terminal(`process spawned pid=${proc.pid}`);
		} catch (err) {
			log.terminal(`failed to spawn process: ${err}`);
			throw err;
		}

		let closed = false;

		const readStream = async (name: string, stream: ReadableStream<Uint8Array> | null) => {
			if (!stream) {
				log.terminal(`pid=${proc.pid} ${name}: no stream`);
				return;
			}
			log.terminal(`pid=${proc.pid} ${name}: reading`);
			const reader = stream.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						log.terminal(`pid=${proc.pid} ${name}: stream ended`);
						break;
					}
					const text = Buffer.from(value).toString();
					log.terminal(`pid=${proc.pid} ${name}: ${text.length} bytes: ${text.trimEnd()}`);
					if (!closed) {
						onData(Buffer.from(value));
					}
				}
			} catch (err) {
				log.terminal(`pid=${proc.pid} ${name}: stream error: ${err}`);
			}
		};

		readStream("stdout", proc.stdout as ReadableStream<Uint8Array>);
		readStream("stderr", proc.stderr as ReadableStream<Uint8Array>);

		proc.exited.then((code) => {
			log.terminal(`pid=${proc.pid} exited code=${code}`);
			if (!closed) {
				closed = true;
				onExit(code);
			}
		});

		return {
			write(data: Buffer | string) {
				if (closed) return;
				try {
					proc.stdin?.write(data);
				} catch (err) {
					log.terminal(`pid=${proc.pid} stdin write error: ${err}`);
				}
			},
			resize(newCols: number, newRows: number) {
				if (closed) return;
				log.terminal(`pid=${proc.pid} resize cols=${newCols} rows=${newRows}`);
				try {
					proc.stdin?.write(`stty rows ${newRows} cols ${newCols} 2>/dev/null\n`);
				} catch (err) {
					log.terminal(`pid=${proc.pid} resize write error: ${err}`);
				}
			},
			close() {
				log.terminal(`pid=${proc.pid} close requested (closed=${closed})`);
				if (closed) return;
				closed = true;
				try {
					proc.kill();
					log.terminal(`pid=${proc.pid} killed`);
				} catch (err) {
					log.terminal(`pid=${proc.pid} kill error: ${err}`);
				}
			},
		};
	}
}
