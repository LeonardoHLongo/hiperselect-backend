/**
 * Logger Centralizado
 * Sistema de logging organizado e visualmente claro
 */

type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';

interface LogOptions {
  level?: LogLevel;
  emoji?: string;
  prefix?: string;
  timestamp?: boolean;
  [key: string]: any; // Permitir propriedades extras para compatibilidade
}

class Logger {
  // Filtro: mostrar apenas logs de IA (tools e raciocínio)
  private aiOnlyMode: boolean = process.env.LOG_AI_ONLY === 'true' || process.env.LOG_AI_ONLY === '1';

  // Prefixos que devem ser mostrados no modo AI only
  private aiPrefixes = [
    '[IA]',
    '[ToolRouter]',
    '[Tool]',
    '[Pipeline]', // Apenas seções relacionadas a tools/IA
    '[DecisionEngine]',
    '[BrainAI]',
    '[AttendantAI]',
    '[LanguageAgent]',
    '[PriceInquiryTool]',
    '[StoreTopicsTool]',
    '[PoliciesTool]',
    '[GreetingsTool]',
    '[AIHandoffTool]',
  ];

  // Emojis que indicam logs de IA
  private aiEmojis = [
    '🤖', // IA
    '⚙️', // Pipeline/Tools
    '🔧', // ToolRouter
    '💰', // PriceInquiry
    '🏪', // StoreTopics
    '📋', // Policies
    '👋', // Greetings
    '🚨', // AIHandoff
    '🗣️', // LanguageAgent
    '🧠', // BrainAI
    '💬', // AttendantAI
  ];

  // Verifica se o log deve ser exibido no modo AI only
  private shouldLog(options?: LogOptions, message?: string): boolean {
    if (!this.aiOnlyMode) {
      return true; // Modo normal: mostrar tudo
    }

    // Modo AI only: verificar prefixo
    if (options?.prefix) {
      return this.aiPrefixes.some(prefix => options.prefix?.includes(prefix) || options.prefix?.startsWith(prefix));
    }

    // Verificar emoji
    if (options?.emoji && this.aiEmojis.includes(options.emoji)) {
      return true;
    }

    // Verificar mensagem por palavras-chave
    if (message) {
      const aiKeywords = [
        'tool',
        'Tool',
        'IA',
        'AI',
        'raciocínio',
        'reasoning',
        'pipeline',
        'Pipeline',
        'gerar resposta',
        'generateResponse',
        'canHandle',
        'run()',
        'ToolRouter',
        'DecisionEngine',
        'AttendantAI',
        'BrainAI',
        'LanguageAgent',
      ];
      return aiKeywords.some(keyword => message.includes(keyword));
    }

    return false;
  }
  private colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Cores por nível
    info: '\x1b[36m',      // Cyan
    success: '\x1b[32m',   // Green
    warning: '\x1b[33m',   // Yellow
    error: '\x1b[31m',     // Red
    debug: '\x1b[90m',     // Gray
    
    // Cores especiais
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    yellow: '\x1b[33m',
  };

  private formatTime(): string {
    const now = new Date();
    return now.toLocaleTimeString('pt-BR', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatMessage(
    message: string,
    options: LogOptions = {}
  ): string {
    const { level = 'info', emoji = '', prefix = '', timestamp = true } = options;
    
    const time = timestamp ? `[${this.formatTime()}]` : '';
    const emojiStr = emoji ? `${emoji} ` : '';
    const prefixStr = prefix ? `${prefix} ` : '';
    const color = this.colors[level];
    
    return `${this.colors.dim}${time}${this.colors.reset} ${color}${emojiStr}${prefixStr}${message}${this.colors.reset}`;
  }

  info(message: string, options?: Omit<LogOptions, 'level'>): void {
    if (!this.shouldLog(options, message)) return;
    console.log(this.formatMessage(message, { ...options, level: 'info' }));
  }

  success(message: string, options?: Omit<LogOptions, 'level'>): void {
    if (!this.shouldLog(options, message)) return;
    console.log(this.formatMessage(message, { ...options, level: 'success' }));
  }

  warning(message: string, options?: Omit<LogOptions, 'level'>): void {
    if (!this.shouldLog(options, message)) return;
    console.log(this.formatMessage(message, { ...options, level: 'warning' }));
  }

  error(message: string, options?: Omit<LogOptions, 'level'>): void {
    if (!this.shouldLog(options, message)) return;
    console.error(this.formatMessage(message, { ...options, level: 'error' }));
  }

  debug(message: string, options?: Omit<LogOptions, 'level'>): void {
    if (!this.shouldLog(options, message)) return;
    console.log(this.formatMessage(message, { ...options, level: 'debug' }));
  }

  // Métodos específicos para diferentes contextos
  message(message: string, details?: Record<string, any>): void {
    this.info(message, { emoji: '💬', prefix: '[Mensagem]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  ai(message: string, details?: Record<string, any>): void {
    this.info(message, { emoji: '🤖', prefix: '[IA]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  whatsapp(message: string, details?: Record<string, any>): void {
    this.info(message, { emoji: '📱', prefix: '[WhatsApp]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  pipeline(message: string, details?: Record<string, any>): void {
    // No modo AI only, mostrar apenas logs relacionados a tools/IA
    if (this.aiOnlyMode) {
      const aiKeywords = ['Tool', 'tool', 'IA', 'AI', 'raciocínio', 'reasoning', 'gerar', 'generate', 'canHandle', 'run()'];
      const isAILog = aiKeywords.some(keyword => message.includes(keyword));
      if (!isAILog) return;
    }
    
    this.info(message, { emoji: '⚙️', prefix: '[Pipeline]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  database(message: string, details?: Record<string, any>): void {
    this.debug(message, { emoji: '🗄️', prefix: '[DB]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  api(message: string, details?: Record<string, any>): void {
    this.info(message, { emoji: '🌐', prefix: '[API]' });
    if (details) {
      console.log(this.colors.dim + JSON.stringify(details, null, 2) + this.colors.reset);
    }
  }

  separator(char: string = '═', length: number = 60): void {
    console.log(this.colors.dim + char.repeat(length) + this.colors.reset);
  }

  section(title: string, emoji?: string): void {
    // No modo AI only, mostrar apenas seções relacionadas a IA
    if (this.aiOnlyMode) {
      const aiKeywords = ['Tool', 'tool', 'IA', 'AI', 'Pipeline', 'Decision', 'Brain', 'Attendant'];
      const isAISection = aiKeywords.some(keyword => title.includes(keyword));
      if (!isAISection) return;
    }
    
    console.log('');
    this.separator('═', 70);
    const emojiStr = emoji ? `${emoji} ` : '';
    console.log(
      `${this.colors.bright}${this.colors.blue}${emojiStr}${title}${this.colors.reset}`
    );
    this.separator('═', 70);
    console.log('');
  }

  group(title: string, items: Array<{ label: string; value: any }>): void {
    // No modo AI only, mostrar apenas grupos relacionados a IA
    if (this.aiOnlyMode) {
      const aiKeywords = ['Tool', 'tool', 'IA', 'AI', 'Pipeline', 'Decision', 'Brain', 'Attendant', 'Executando', 'Resultado'];
      const isAIGroup = aiKeywords.some(keyword => title.includes(keyword));
      if (!isAIGroup) return;
    }
    
    console.log('');
    console.log(`${this.colors.bright}${this.colors.magenta}▶ ${title}${this.colors.reset}`);
    items.forEach(({ label, value }) => {
      const formattedValue = typeof value === 'object' 
        ? JSON.stringify(value, null, 2)
        : String(value);
      console.log(
        `${this.colors.dim}  • ${label}:${this.colors.reset} ${this.colors.bright}${formattedValue}${this.colors.reset}`
      );
    });
    console.log('');
  }

  groupEnd(): void {
    console.log(`${this.colors.dim}────────────────────────────────────────────────────────${this.colors.reset}`);
    console.log('');
  }

  // Método público para verificar se está no modo AI only
  isAIOnlyMode(): boolean {
    return this.aiOnlyMode;
  }
}

export const logger = new Logger();

// Logar status do modo AI only na inicialização
if (logger.isAIOnlyMode()) {
  console.log('\n\x1b[33m⚠️  MODO AI ONLY ATIVADO - Mostrando apenas logs de IA/Tools/Raciocínio\x1b[0m\n');
}