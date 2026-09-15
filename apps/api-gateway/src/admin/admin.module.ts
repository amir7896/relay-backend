import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ProxyModule } from '../infrastructure/proxy/proxy.module';
import { StorageModule } from '../storage/storage.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [ProxyModule, ChatModule, StorageModule],
  controllers: [AdminController],
})
export class AdminModule {}
