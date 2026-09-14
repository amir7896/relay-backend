import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiWrappedResponse,
} from '@app/common';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { DeletedResultSchema, UserProfileSchema } from './users.schema';

export const UsersDocs = () =>
  applyDecorators(ApiTags('Users'), ApiBearerAuth(), ApiErrorResponses());

export const ListUsersDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'List users (admin)',
      description:
        'Uses query-string JSON values, for example `?page=1&limit=10&sortBy=createdAt&order=DESC`.',
    }),
    ApiPaginatedResponse(UserProfileSchema),
  );

export const ListDirectoryDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'List people in the workspace',
      description:
        'Any signed-in member can search the directory to start a chat. Does not include admin-only actions.',
    }),
    ApiPaginatedResponse(UserProfileSchema),
  );

export const GetMyProfileDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get the authenticated user profile' }),
    ApiWrappedResponse(UserProfileSchema, {
      description: 'Profile retrieved successfully',
    }),
  );

export const UpdateMyProfileDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update the authenticated user profile' }),
    ApiBody({ type: UpdateProfileDto }),
    ApiWrappedResponse(UserProfileSchema, {
      description: 'User updated successfully',
    }),
  );

export const UploadMyAvatarDocs = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Upload profile photo',
      description:
        'Uploads the image to Cloudinary under `relay/profilePictures/` and saves the URL on the user profile.',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'JPEG, PNG, GIF, or WebP (max 10MB)',
          },
        },
      },
    }),
    ApiWrappedResponse(UserProfileSchema, {
      description: 'Profile photo updated successfully',
    }),
  );

export const GetUserDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get a user profile by id (admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiWrappedResponse(UserProfileSchema, {
      description: 'User retrieved successfully',
    }),
  );

export const UpdateUserDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update a user profile (admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiBody({ type: UpdateProfileDto }),
    ApiWrappedResponse(UserProfileSchema, {
      description: 'User updated successfully',
    }),
  );

export const DeleteUserDocs = () =>
  applyDecorators(
    ApiOperation({ summary: 'Soft-delete a user profile (admin)' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiWrappedResponse(DeletedResultSchema, {
      description: 'User deleted successfully',
    }),
  );
