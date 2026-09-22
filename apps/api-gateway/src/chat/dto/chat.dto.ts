import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  ConversationMemberRole,
  MessageType,
  isValidReactionEmoji,
} from '@app/common';

export class CreatePrivateChatDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The other user’s account id (`userId` from the profile or `/auth/me`)',
  })
  @IsUUID('4')
  userId!: string;
}

export class CreateGroupChatDto {
  @ApiProperty({ example: 'Weekend trip' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    type: [String],
    example: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    description: 'Account ids of other members (optional for channels)',
  })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  memberIds!: string[];

  @ApiPropertyOptional({
    enum: ['public', 'private'],
    default: 'private',
    description: 'Public channels are browsable/joinable by org members',
  })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({
    default: false,
    description: 'When true, only owners/admins can post',
  })
  @IsOptional()
  @IsBoolean()
  announceOnly?: boolean;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Hello there' })
  @ValidateIf((dto: SendMessageDto) => !dto.attachmentUrl)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Message id this text is replying to',
  })
  @IsOptional()
  @IsUUID('4')
  replyToMessageId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Post into a Slack-style thread under this root message',
  })
  @IsOptional()
  @IsUUID('4')
  threadRootId?: string;

  @ApiPropertyOptional({
    description:
      'When replying in a thread, also post a copy to the main channel',
  })
  @IsOptional()
  @IsBoolean()
  alsoSendToChannel?: boolean;

  @ApiPropertyOptional({
    example: '/uploads/abc.jpg',
    description:
      'Public URL of the attachment (local `/uploads/...`, or absolute S3/Cloudinary URL)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  attachmentUrl?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  attachmentMime?: string;

  @ApiPropertyOptional({ example: 'photo.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  attachmentName?: string;

  @ApiPropertyOptional({ example: 204800 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  attachmentSize?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'User ids mentioned in this message (groups)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mentionUserIds?: string[];

  @ApiPropertyOptional({
    description: 'Open Graph preview card for the first URL in the message',
  })
  @IsOptional()
  linkPreview?: {
    url: string;
    title: string;
    description: string;
    image: string | null;
  } | null;
}

export class EditMessageDto {
  @ApiProperty({ example: 'Updated text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class ReactMessageDto {
  @ApiProperty({
    example: '👍',
    description: 'Unicode emoji or workspace :shortcode:',
  })
  @IsString()
  @MaxLength(64)
  @ValidateBy({
    name: 'isReactionEmoji',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isValidReactionEmoji(value),
      defaultMessage: () => 'Unsupported reaction emoji',
    },
  })
  emoji!: string;
}

export class ForwardMessageDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Conversation to forward the message into',
  })
  @IsUUID('4')
  conversationId!: string;
}

export class MuteConversationDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  muted!: boolean;
}

export class PinConversationDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  pinned!: boolean;
}

export class SetDisappearingDto {
  @ApiProperty({
    example: 86400,
    description:
      'Seconds until new messages disappear. 0 = off. Allowed: 0, 30, 60, 3600, 86400, 604800, 7776000',
    enum: [0, 30, 60, 3600, 86400, 604800, 7776000],
  })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 30, 60, 3600, 86400, 604800, 7776000])
  durationSeconds!: number;
}

export class PinMessageDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  pinned!: boolean;
}

export class ScheduleMessageDto extends SendMessageDto {
  @ApiProperty({
    example: '2026-09-12T18:30:00.000Z',
    description: 'ISO timestamp when the message should be sent (min 1 minute ahead)',
  })
  @IsDateString()
  scheduledFor!: string;
}

export class UpsertDraftDto {
  @ApiProperty({ example: 'Draft text…', maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  body!: string;
}

export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional({ enum: ['all', 'mentions', 'none'] })
  @IsOptional()
  @IsIn(['all', 'mentions', 'none'])
  mode?: 'all' | 'mentions' | 'none';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietStart?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietEnd?: string;

  @ApiPropertyOptional({ example: 'Asia/Karachi' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Suppress message push when Away / Busy / DND is set',
  })
  @IsOptional()
  @IsBoolean()
  respectStatus?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Keyword / phrase highlights (max 50)',
    example: ['urgent', 'P0'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @ArrayMaxSize(50)
  keywords?: string[];
}

export class UpdateChannelNotificationPrefsDto {
  @ApiProperty({
    enum: ['default', 'all', 'mentions', 'none'],
    description:
      'Per-channel override. default = use global Message alerts setting.',
  })
  @IsIn(['default', 'all', 'mentions', 'none'])
  mode!: 'default' | 'all' | 'mentions' | 'none';
}

export class CreateReminderDto {
  @ApiProperty({
    example: '2026-09-12T18:30:00.000Z',
    description: 'ISO timestamp when to remind (min 1 minute, max 30 days)',
  })
  @IsDateString()
  remindAt!: string;
}

export class DeleteMessageDto {
  @ApiPropertyOptional({
    example: false,
    description:
      'When true, delete for everyone (sender only). Receiver delete uses forEveryone=false (hide for me only).',
  })
  @IsOptional()
  @IsBoolean()
  forEveryone?: boolean;
}

export class SetMemberRoleDto {
  @ApiProperty({
    enum: [ConversationMemberRole.ADMIN, ConversationMemberRole.MEMBER],
    example: ConversationMemberRole.ADMIN,
  })
  @IsIn([ConversationMemberRole.ADMIN, ConversationMemberRole.MEMBER])
  role!: ConversationMemberRole.ADMIN | ConversationMemberRole.MEMBER;
}

export class BlockUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId!: string;
}

export class TypingDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  typing!: boolean;
}

export class MarkSeenDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Mark as read up to this message. Omit to mark everything as seen now.',
  })
  @IsOptional()
  @IsUUID('4')
  messageId?: string;
}

export class MarkUnreadDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Mark this message (and everything after it) as unread — Slack-style triage.',
  })
  @IsUUID('4')
  messageId!: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}

export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Project Alpha' })
  @ValidateIf(
    (dto: UpdateGroupDto) =>
      dto.name !== undefined ||
      (dto.visibility === undefined &&
        dto.announceOnly === undefined &&
        dto.topic === undefined &&
        dto.description === undefined),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({
    description: 'When true, only owners/admins can post',
  })
  @IsOptional()
  @IsBoolean()
  announceOnly?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 250,
    description: 'Short channel topic shown under the channel name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  topic?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 2000,
    description: 'Longer channel purpose / description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class AddChannelBookmarkDto {
  @ApiProperty({ example: 'Design docs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @ApiProperty({ example: 'https://example.com/docs' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Matches(/^https?:\/\//i, {
    message: 'url must start with http:// or https://',
  })
  url!: string;
}

export class CreateChannelInviteDto {
  @ApiPropertyOptional({
    example: 72,
    description: 'Hours until the invite expires',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  expiresInHours?: number;

  @ApiPropertyOptional({
    example: 25,
    description: 'Maximum number of successful accepts',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxUses?: number;
}

export class EmailChannelInviteDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ example: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  expiresInHours?: number;
}

export class CreatePollDto {
  @ApiProperty({ example: 'Where should we go for lunch?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  question!: string;

  @ApiProperty({
    type: [String],
    example: ['Cafe', 'Office', 'Takeout'],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options!: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowMultiple?: boolean;
}

export class VotePollDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  optionId!: string;
}

export class SaveBookmarkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  messageId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Optional bookmark collection folder',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  collectionId?: string | null;
}

export class ChatPageQueryDto {
  @ApiPropertyOptional({ type: Number, example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ListBookmarksQueryDto extends ChatPageQueryDto {
  @ApiPropertyOptional({
    description: 'Limit bookmarks to a single conversation',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by collection id, or pass "none" for uncategorized bookmarks',
  })
  @IsOptional()
  @IsString()
  collectionId?: string;
}

export class BookmarkCollectionNameDto {
  @ApiProperty({ example: 'Design notes' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class MoveBookmarkDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Target folder, or null to remove from folders',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  collectionId?: string | null;
}

export class ListRemindersQueryDto extends ChatPageQueryDto {
  @ApiPropertyOptional({
    enum: ['open', 'done', 'all'],
    default: 'open',
    description: 'open=pending, done=completed+sent, all=both',
  })
  @IsOptional()
  @IsIn(['open', 'done', 'all'])
  scope: 'open' | 'done' | 'all' = 'open';
}

export class SearchMessagesQueryDto extends ChatPageQueryDto {
  @ApiProperty({ example: 'hello', description: 'Search text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;
}

export class ListMediaQueryDto extends ChatPageQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'image', 'file', 'audio', 'video'],
    default: 'all',
    description: 'Filter media by kind',
  })
  @IsOptional()
  @IsIn(['all', 'image', 'file', 'audio', 'video'])
  kind: 'all' | 'image' | 'file' | 'audio' | 'video' = 'all';
}

export class CreateSidebarSectionDto {
  @ApiProperty({ example: 'Design' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

export class UpdateSidebarSectionDto {
  @ApiPropertyOptional({ example: 'Design' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  conversationIds?: string[];
}

export class ReorderStarredConversationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  conversationIds!: string[];
}

export class CreateIncomingWebhookDto {
  @ApiProperty({ example: 'CI Deployments' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'GitHub' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  defaultUsername?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/bot.png' })
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//i, {
    message: 'defaultIconUrl must start with http:// or https://',
  })
  defaultIconUrl?: string;
}

export class CreateOutgoingWebhookDto {
  @ApiProperty({ example: 'PagerDuty' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'https://hooks.example.com/relay' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^https:\/\//i, {
    message: 'targetUrl must start with https://',
  })
  targetUrl!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  excludeBots?: boolean;
}

export class PostIncomingWebhookDto {
  @ApiProperty({ example: 'Build #42 succeeded' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional({ example: 'CI Bot' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  username?: string;
}

export class CreateSlashCommandDto {
  @ApiProperty({ example: 'deploy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, {
    message:
      'name must start with a letter and use only letters, numbers, underscore',
  })
  name!: string;

  @ApiProperty({ example: 'Announce a deployment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  description!: string;

  @ApiPropertyOptional({
    example: 'Deploying: {text}',
    description: 'Supports {text} and {user} placeholders',
  })
  @ValidateIf((dto: CreateSlashCommandDto) => !dto.requestUrl)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  responseTemplate?: string;

  @ApiPropertyOptional({ enum: ['in_channel', 'ephemeral'], default: 'in_channel' })
  @IsOptional()
  @IsIn(['in_channel', 'ephemeral'])
  responseMode?: 'in_channel' | 'ephemeral';

  @ApiPropertyOptional({ example: 'https://hooks.example.com/slash' })
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsString()
  @MaxLength(500)
  @Matches(/^https:\/\//i, {
    message: 'requestUrl must start with https://',
  })
  requestUrl?: string;
}

export class InvokeSlashCommandDto {
  @ApiProperty({ example: '/shrug almost Friday' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  raw!: string;
}

export class CreateUserGroupDto {
  @ApiProperty({ example: 'eng' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, {
    message:
      'handle must start with a letter and use only letters, numbers, underscore',
  })
  handle!: string;

  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'Backend + frontend engineers' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}

export class UpdateUserGroupDto {
  @ApiPropertyOptional({ example: 'eng' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, {
    message:
      'handle must start with a letter and use only letters, numbers, underscore',
  })
  handle?: string;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'Backend + frontend engineers' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  memberIds?: string[];
}
