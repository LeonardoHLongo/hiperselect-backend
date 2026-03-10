/**
 * Auth Service
 * Lógica de autenticação e registro
 */

import type { IAuthRepository } from './repository';
import type { LoginInput, RegisterInput, AuthResult, User } from './types';
import { generateToken } from './jwt';
import { hashPassword, verifyPassword } from './repository-postgres';

export class AuthService {
  constructor(private repository: IAuthRepository) {}

  /**
   * Registra um novo tenant e usuário admin
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    // Criar tenant
    const tenantResult = this.repository.createTenant(input.tenantName, input.tenantSlug);
    const tenant = tenantResult instanceof Promise ? await tenantResult : tenantResult;

    // Hash da senha
    const passwordHash = await hashPassword(input.userPassword);

    // Criar usuário admin
    const userResult = this.repository.createUser({
      tenantId: tenant.id,
      email: input.userEmail,
      passwordHash,
      name: input.userName,
      role: 'admin',
    });
    const user = userResult instanceof Promise ? await userResult : userResult;

    // Gerar token
    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user,
      token,
    };
  }

  /**
   * Login de usuário
   * Busca o usuário pelo email globalmente e usa o tenantId do próprio usuário
   */
  async login(input: LoginInput): Promise<AuthResult | null> {
    // Buscar usuário por email globalmente (sem precisar do tenantId)
    const userResult = this.repository.getUserByEmailGlobal(input.email);
    const user = userResult instanceof Promise ? await userResult : userResult;

    if (!user) {
      return null;
    }

    // Buscar hash da senha do banco
    const passwordHash = await this.getPasswordHash(user.id);
    if (!passwordHash) {
      return null;
    }

    // Verificar senha
    let isValid = false;
    
    if (passwordHash === 'AUTH_USERS') {
      // Usuário está no auth.users (novo sistema) - verificar via Supabase Auth
      // IMPORTANTE: signInWithPassword requer chave anônima, não service role
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL;
      // Usar chave anônima para sign in (não service role)
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseAnonKey) {
        // Criar cliente com chave anônima para sign in
        const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
        
        // Tentar fazer sign in com as credenciais
        // Se funcionar, a senha está correta
        const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        });
        
        isValid = !authError && !!authData?.user;
        
        if (!isValid && authError) {
          console.error('[AuthService] Erro ao verificar senha via Auth:', authError.message);
        }
      } else {
        console.error('[AuthService] SUPABASE_URL ou SUPABASE_ANON_KEY não configurados');
      }
    } else {
      // Usuário está na tabela users (sistema antigo) - verificar hash
      isValid = await verifyPassword(input.password, passwordHash);
    }
    
    if (!isValid) {
      return null;
    }

    // Gerar token
    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user,
      token,
    };
  }

  /**
   * Busca hash da senha do banco
   * Suporta tanto sistema antigo (tabela users) quanto novo (auth.users)
   */
  private async getPasswordHash(userId: string): Promise<string | null> {
    // Se o repository for Postgres, buscar diretamente
    if (this.repository.constructor.name === 'PostgresAuthRepository') {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        return null;
      }

      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // 1. Primeiro tenta buscar na tabela users (sistema antigo)
      const { data: oldUser, error: oldError } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', userId)
        .maybeSingle();

      if (oldUser && oldUser.password_hash && !oldError) {
        return oldUser.password_hash;
      }

      // 2. Se não encontrou, o usuário está no auth.users (novo sistema)
      // Para auth.users, não temos acesso ao hash diretamente
      // Mas podemos verificar a senha usando o Supabase Auth
      // Retornamos um marcador especial que indica que devemos usar auth.users
      return 'AUTH_USERS'; // Marcador especial
    }

    // Para in-memory, usar método do repository
    if (typeof (this.repository as any).getPasswordHash === 'function') {
      return (this.repository as any).getPasswordHash(userId);
    }

    return null;
  }

  /**
   * Valida token e retorna usuário
   */
  async validateToken(token: string): Promise<User | null> {
    const { verifyToken } = require('./jwt');
    const payload = verifyToken(token);

    if (!payload) {
      return null;
    }

    const userResult = this.repository.getUserById(payload.userId);
    const user = userResult instanceof Promise ? await userResult : userResult;

    if (!user || user.tenantId !== payload.tenantId) {
      return null;
    }

    return user;
  }
}

