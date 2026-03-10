# Database Migration Guide

## Setup Supabase PostgreSQL

### 1. Configure Environment Variables

Add to `backend/.env`:

```env
SUPABASE_URL=https://ooancmvihrxzgtegvmwn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 2. Run Schema Migration

Execute the SQL schema in Supabase SQL Editor:

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents from `backend/database/schema.sql` or `backend/src/database/migrations/001_initial_schema.sql`
3. Execute the SQL

Or use the migration script (if RPC is configured):

```bash
cd backend
npm run migrate
```

### 3. Verify Tables Created

Check that these tables exist:
- `conversations`
- `messages`
- `tickets`
- `ai_decisions`

### 4. Backend Configuration

The backend automatically uses PostgreSQL if `SUPABASE_URL` is set in environment variables.

If `SUPABASE_URL` is not set, it falls back to in-memory storage.

## Schema Details

### conversations
- `id` (TEXT PRIMARY KEY) - conversationId (phone number)
- `jid` (TEXT UNIQUE) - Full WhatsApp JID
- `phone_number` (TEXT) - Phone number only
- `display_name` (TEXT) - Contact name
- `profile_picture_url` (TEXT) - Profile picture URL
- `ai_enabled` (BOOLEAN) - AI auto-response enabled
- `last_message` (TEXT) - Last message text
- `last_message_at` (TIMESTAMP) - Last message timestamp
- `created_at` (TIMESTAMP) - Creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

### messages
- `id` (TEXT PRIMARY KEY) - messageId
- `conversation_id` (TEXT) - References conversations(id)
- `text` (TEXT) - Message text (nullable)
- `timestamp` (BIGINT) - Message timestamp (milliseconds)
- `sender_phone_number` (TEXT) - Sender phone number
- `sender_jid` (TEXT) - Sender JID
- `sender_push_name` (TEXT) - Sender display name
- `sender_profile_picture_url` (TEXT) - Sender profile picture
- `media_type` (TEXT) - Media type: image, audio, video, document
- `media_mimetype` (TEXT) - Media MIME type
- `media_caption` (TEXT) - Media caption
- `media_url` (TEXT) - Media URL (for download)
- `media_media_id` (TEXT) - Media ID
- `message_type` (TEXT) - Message type
- `baileys_key_id` (TEXT) - Baileys message key ID
- `baileys_key_remote_jid` (TEXT) - Baileys remote JID
- `baileys_key_from_me` (BOOLEAN) - Message from me
- `baileys_message` (JSONB) - Full Baileys message (for media download)
- `created_at` (TIMESTAMP) - Creation timestamp

### tickets
- `id` (UUID PRIMARY KEY) - Ticket ID
- `conversation_id` (TEXT) - References conversations(id)
- `state` (TEXT) - Ticket state
- `category` (TEXT) - Ticket category
- `priority` (TEXT) - Ticket priority
- `risk` (BOOLEAN) - Risk flag
- `intent` (TEXT) - AI detected intent
- `sentiment` (TEXT) - AI detected sentiment
- `urgency` (TEXT) - AI detected urgency
- `risk_level` (TEXT) - AI detected risk level
- `confidence` (NUMERIC) - AI confidence score
- `reasoning` (TEXT) - AI reasoning
- `ai_version` (TEXT) - AI model version
- `suggested_response` (TEXT) - Suggested response
- `human_notes` (TEXT) - Human notes
- `created_at` (TIMESTAMP) - Creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

### ai_decisions
- `id` (UUID PRIMARY KEY) - Decision ID
- `message_id` (TEXT) - References messages(id)
- `decision` (TEXT) - Decision: AUTO_RESPOND or CREATE_TICKET
- `confidence` (NUMERIC) - Confidence score
- `reasoning` (TEXT) - Decision reasoning
- `model` (TEXT) - AI model used
- `intent` (TEXT) - Detected intent
- `sentiment` (TEXT) - Detected sentiment
- `urgency` (TEXT) - Detected urgency
- `risk_level` (TEXT) - Detected risk level
- `ai_version` (TEXT) - AI version
- `created_at` (TIMESTAMP) - Creation timestamp

## Migration Notes

- RLS (Row Level Security) is **disabled** for Phase 1
- All foreign keys use `ON DELETE CASCADE`
- Indexes are created for performance on common queries
- The repository interface remains the same - code is compatible with both in-memory and PostgreSQL

