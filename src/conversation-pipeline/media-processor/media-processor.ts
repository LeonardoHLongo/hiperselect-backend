/**
 * Media Processor
 * Processa mídia (áudio e imagem) usando IA para gerar texto processável
 * 
 * Responsabilidades:
 * - Transcrição de áudio usando OpenAI Whisper
 * - Análise de imagem usando GPT-4o Vision
 * - Injeção do texto processado na mensagem
 */

import OpenAI from 'openai';
import type { MediaInfo } from '../../messages/types';
import { logger } from '../../utils/logger';
import type { WhatsAppAdapter } from '../../whatsapp/adapter';

type MediaProcessorDependencies = {
  openaiApiKey: string;
  whatsAppAdapter: WhatsAppAdapter;
};

export class MediaProcessor {
  private openai: OpenAI;

  constructor(private deps: MediaProcessorDependencies) {
    this.openai = new OpenAI({
      apiKey: deps.openaiApiKey,
    });
  }

  /**
   * Processa mídia e retorna texto processado
   * @param media - Informações da mídia
   * @param baileysMessage - Mensagem completa do Baileys (para download)
   * @param existingText - Texto existente (caption, etc)
   * @returns Texto processado ou null se não for possível processar
   */
  async processMedia(
    media: MediaInfo,
    baileysMessage: any,
    existingText: string | null
  ): Promise<string | null> {
    if (media.type === 'audio') {
      return await this.transcribeAudio(media, baileysMessage, existingText);
    } else if (media.type === 'image') {
      return await this.analyzeImage(media, baileysMessage, existingText);
    }

    // Para vídeo e documento, usar caption se disponível
    if (existingText) {
      return existingText;
    }

    return null;
  }

  /**
   * Transcreve áudio usando OpenAI Whisper
   */
  private async transcribeAudio(
    media: MediaInfo,
    baileysMessage: any,
    existingText: string | null
  ): Promise<string | null> {
    try {
      logger.group('🎵 [Mídia] Processando áudio com Whisper', [
        { label: 'Mimetype', value: media.mimetype || 'N/A' },
        { label: 'Texto existente', value: existingText || 'Nenhum' },
      ]);

      // Se já houver texto (caption), usar ele
      if (existingText && existingText.trim().length > 0) {
        logger.pipeline('ℹ️ Áudio já possui texto (caption) - usando texto existente', {
          text: existingText.substring(0, 50) + '...',
        });
        logger.groupEnd();
        return existingText;
      }

      // Baixar áudio do WhatsApp
      logger.pipeline('📥 Baixando áudio do WhatsApp...');
      const audioBuffer = await this.deps.whatsAppAdapter.downloadMessageMedia(baileysMessage);

      if (!audioBuffer) {
        logger.error('❌ [Mídia] Falha ao baixar áudio do WhatsApp', {
          prefix: '[MediaProcessor]',
          emoji: '❌',
        });
        logger.groupEnd();
        return null;
      }

      logger.pipeline('✅ Áudio baixado', {
        sizeBytes: audioBuffer.length,
        sizeKB: Math.round(audioBuffer.length / 1024),
      });

      // OpenAI Whisper aceita File, Blob, ou stream no Node.js
      // Whisper aceita: mp3, mp4, mpeg, mpga, m4a, wav, webm
      const fileExtension = this.getAudioFileExtension(media.mimetype);
      const fileName = `audio.${fileExtension}`;

      logger.pipeline('🔄 Enviando áudio para Whisper API...', {
        fileName,
        sizeBytes: audioBuffer.length,
        mimetype: media.mimetype || 'audio/ogg',
      });
      
      // Criar File object usando Blob (disponível no Node.js 18+)
      // OpenAI SDK aceita File ou Blob nativamente
      // Converter Buffer para Uint8Array para garantir compatibilidade
      const uint8Array = new Uint8Array(audioBuffer);
      let file: File | Blob;
      
      if (typeof File !== 'undefined') {
        // Node.js 20+ tem File nativo
        file = new File([uint8Array], fileName, {
          type: media.mimetype || 'audio/ogg',
        });
        logger.pipeline('📦 Usando File nativo do Node.js');
      } else if (typeof Blob !== 'undefined') {
        // Node.js 18+ tem Blob nativo (mas não File)
        const blob = new Blob([uint8Array], { type: media.mimetype || 'audio/ogg' });
        // Criar File-like object a partir do Blob
        // OpenAI SDK aceita Blob diretamente, mas adicionar name para compatibilidade
        file = Object.assign(blob, {
          name: fileName,
          lastModified: Date.now(),
        }) as File;
        logger.pipeline('📦 Usando Blob nativo do Node.js com wrapper File-like');
      } else {
        // Fallback: criar objeto File-like manualmente usando stream
        const { Readable } = require('stream');
        const stream = Readable.from(audioBuffer);
        // Adicionar propriedades necessárias
        (stream as any).name = fileName;
        (stream as any).type = media.mimetype || 'audio/ogg';
        file = stream as any;
        logger.pipeline('📦 Usando stream Readable como fallback');
      }

      // Transcrever usando Whisper
      const transcription = await this.openai.audio.transcriptions.create({
        file: file as any,
        model: 'whisper-1',
        language: 'pt', // Português
        response_format: 'text',
      });

      const transcribedText = typeof transcription === 'string' 
        ? transcription 
        : transcription.text || '';

      if (!transcribedText || transcribedText.trim().length === 0) {
        logger.warning('⚠️ [Mídia] Whisper retornou texto vazio', {
          prefix: '[MediaProcessor]',
          emoji: '⚠️',
        });
        logger.groupEnd();
        return null;
      }

      logger.success('✅ [Mídia] Áudio transcrito com Whisper', {
        prefix: '[MediaProcessor]',
        emoji: '✅',
        textLength: transcribedText.length,
        preview: transcribedText.substring(0, 100) + (transcribedText.length > 100 ? '...' : ''),
      });

      logger.pipeline('📝 [Mídia] Áudio transcrito com Whisper:', {
        text: transcribedText,
      });

      logger.groupEnd();
      return transcribedText.trim();
    } catch (error) {
      // Log detalhado do erro para debug
      const errorDetails: any = {
        prefix: '[MediaProcessor]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      };

      // Adicionar detalhes específicos do erro da OpenAI
      if (error && typeof error === 'object') {
        if ('status' in error) {
          errorDetails.status = (error as any).status;
        }
        if ('code' in error) {
          errorDetails.code = (error as any).code;
        }
        if ('response' in error) {
          errorDetails.response = (error as any).response;
        }
        if ('request' in error) {
          errorDetails.request = (error as any).request;
        }
      }

      logger.error('❌ [Mídia] Erro ao transcrever áudio com Whisper', errorDetails);
      logger.pipeline('🔍 Detalhes completos do erro:', {
        error: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
      });
      return null;
    }
  }

  /**
   * Analisa imagem usando GPT-4o Vision
   */
  private async analyzeImage(
    media: MediaInfo,
    baileysMessage: any,
    existingText: string | null
  ): Promise<string | null> {
    try {
      logger.group('📷 [Mídia] Processando imagem com Vision', [
        { label: 'Mimetype', value: media.mimetype || 'N/A' },
        { label: 'Caption existente', value: existingText || 'Nenhum' },
      ]);

      // Baixar imagem do WhatsApp
      logger.pipeline('📥 Baixando imagem do WhatsApp...');
      const imageBuffer = await this.deps.whatsAppAdapter.downloadMessageMedia(baileysMessage);

      if (!imageBuffer) {
        logger.error('❌ [Mídia] Falha ao baixar imagem do WhatsApp', {
          prefix: '[MediaProcessor]',
          emoji: '❌',
        });
        logger.groupEnd();
        return existingText; // Retornar caption se disponível
      }

      logger.pipeline('✅ Imagem baixada', {
        sizeBytes: imageBuffer.length,
        sizeKB: Math.round(imageBuffer.length / 1024),
      });

      // Converter buffer para base64
      const base64Image = imageBuffer.toString('base64');
      const mimeType = media.mimetype || 'image/jpeg';

      logger.pipeline('🔄 Enviando imagem para GPT-4o Vision...');

      // Analisar usando GPT-4o Vision
      const visionResponse = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Descreva de forma curta e objetiva o que aparece nesta imagem de supermercado (produtos, marcas, quantidades ou encartes de preços). Se for um produto, identifique o nome para consulta de estoque.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 300, // Limitar resposta para ser curta e objetiva
        temperature: 0.3, // Baixa temperatura para respostas mais objetivas
      });

      const description = visionResponse.choices[0]?.message?.content || '';

      if (!description || description.trim().length === 0) {
        logger.warning('⚠️ [Mídia] Vision retornou descrição vazia', {
          prefix: '[MediaProcessor]',
          emoji: '⚠️',
        });
        logger.groupEnd();
        return existingText; // Retornar caption se disponível
      }

      // Combinar caption existente com descrição se houver
      let finalText = description.trim();
      if (existingText && existingText.trim().length > 0) {
        finalText = `${existingText.trim()} ${description.trim()}`;
      }

      logger.success('✅ [Mídia] Imagem analisada por Vision', {
        prefix: '[MediaProcessor]',
        emoji: '✅',
        textLength: finalText.length,
        preview: finalText.substring(0, 100) + (finalText.length > 100 ? '...' : ''),
      });

      logger.pipeline('📝 [Mídia] Imagem analisada por Vision:', {
        text: finalText,
      });

      logger.groupEnd();
      return finalText;
    } catch (error) {
      logger.error('❌ [Mídia] Erro ao analisar imagem com Vision', {
        prefix: '[MediaProcessor]',
        emoji: '❌',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return existingText; // Retornar caption se disponível em caso de erro
    }
  }

  /**
   * Obtém extensão de arquivo apropriada para o mimetype do áudio
   */
  private getAudioFileExtension(mimetype?: string): string {
    if (!mimetype) {
      return 'ogg'; // Padrão para WhatsApp
    }

    const mimeMap: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    };

    return mimeMap[mimetype.toLowerCase()] || 'ogg';
  }
}
