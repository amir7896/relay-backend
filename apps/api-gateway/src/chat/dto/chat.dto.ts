import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ALLOWED_REACTIONS, ConversationMemberRole, MessageType } from '@app/common';

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
  @ApiProperty({ example: '👍', enum: ALLOWED_REACTIONS })
  @IsString()
  @IsIn([...ALLOWED_REACTIONS])
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

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}

export class UpdateGroupDto {
  @ApiProperty({ example: 'Project Alpha' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
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

export class SearchMessagesQueryDto extends ChatPageQueryDto {
  @ApiProperty({ example: 'hello', description: 'Search text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;
}

export class ListMediaQueryDto extends ChatPageQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'image', 'file', 'audio'],
    default: 'all',
    description: 'Filter media by kind',
  })
  @IsOptional()
  @IsIn(['all', 'image', 'file', 'audio'])
  kind: 'all' | 'image' | 'file' | 'audio' = 'all';
}
