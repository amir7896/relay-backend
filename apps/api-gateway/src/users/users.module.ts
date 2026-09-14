import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { UsersController } from './users.controller';

@Module({
  imports: [StorageModule],
  controllers: [UsersController],
})
export class UsersModule {}
