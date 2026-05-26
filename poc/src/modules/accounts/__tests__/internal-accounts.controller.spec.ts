import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InternalAccountsController } from '../internal-accounts.controller';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { PrismaService } from '../../../shared/database/prisma.service';

describe('InternalAccountsController', () => {
  const workspaces = { findBySlug: jest.fn() };
  const prisma = { account: { findMany: jest.fn() } };
  let controller: InternalAccountsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [InternalAccountsController],
      providers: [
        { provide: WorkspacesService, useValue: workspaces },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = mod.get(InternalAccountsController);
  });

  it('lists accounts for a workspace slug + end_user_id, scoped by platform', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([
      { id: 14n, platform: 'tiktok', handle: 'camaleonicanalytics', displayName: null, status: 'ready' },
    ]);
    const res = await controller.list('demo', 'test@example.com', 'tiktok');
    expect(workspaces.findBySlug).toHaveBeenCalledWith('demo');
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'test@example.com', status: { not: 'disconnected' }, platform: 'tiktok' },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
    expect(res.data).toEqual([
      { id: '14', platform: 'tiktok', handle: 'camaleonicanalytics', display_name: null, status: 'ready' },
    ]);
  });

  it('omits the platform filter when platform is absent', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([]);
    await controller.list('demo', 'test@example.com', undefined);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'test@example.com', status: { not: 'disconnected' } },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
  });

  it('rejects when ws_slug is missing', async () => {
    await expect(controller.list('', 'test@example.com', undefined)).rejects.toThrow();
    expect(workspaces.findBySlug).not.toHaveBeenCalled();
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });
});
