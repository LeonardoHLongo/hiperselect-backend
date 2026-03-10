export { AuthService } from './service';
export { createAuthRepository } from './repository';
export { createPostgresAuthRepository } from './repository-postgres';
export { generateToken, verifyToken, extractTokenFromHeader } from './jwt';
export { authMiddleware } from './middleware';
export { hashPassword, verifyPassword } from './repository-postgres';
export type { User, Tenant, JWTPayload, LoginInput, RegisterInput, AuthResult, UserRole } from './types';
export type { IAuthRepository } from './repository';

