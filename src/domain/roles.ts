/**
 * Papeis (2): admin (dono) e user (todo o resto).
 *
 * user: so as tools construidas pro bot (pesquisa web, midia, historico...).
 * Nada de shell, nada de arquivo da maquina do bot, nem leitura: arquivo
 * local e superficie de vazamento. admin: tudo.
 */

export type Role = "admin" | "user";

export function roleOf(userId: string, adminIds: readonly string[]): Role {
	return userId !== "" && adminIds.includes(userId) ? "admin" : "user";
}

/** Shell e arquivos da maquina onde o bot roda. */
export function canUseHostTools(role: Role): boolean {
	return role === "admin";
}
