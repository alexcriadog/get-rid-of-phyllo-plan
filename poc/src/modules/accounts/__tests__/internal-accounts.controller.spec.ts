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
    const res = await controller.list('demo', 'test@example.com', 'tiktok', undefined, undefined);
    expect(workspaces.findBySlug).toHaveBeenCalledWith('demo');
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'test@example.com', status: { not: 'disconnected' }, platform: 'tiktok' },
      orderBy: { id: 'desc' },
      take: 101, // limit (100) + 1 to detect has_more
    });
    expect(res.data).toEqual([
      { id: '14', platform: 'tiktok', handle: 'camaleonicanalytics', display_name: null, status: 'ready' },
    ]);
    expect(res.meta).toEqual({ count: 1, has_more: false, next_cursor: null });
  });

  it('omits the platform filter when platform is absent', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([]);
    await controller.list('demo', 'test@example.com', undefined, undefined, undefined);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'test@example.com', status: { not: 'disconnected' } },
      orderBy: { id: 'desc' },
      take: 101,
    });
  });

  it('applies the cursor as an id < filter (next page)', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([]);
    // Cursor is base64url("4210") → decodes to BigInt 4210.
    const cursor = Buffer.from('4210', 'utf8').toString('base64url');
    await controller.list('demo', 'test@example.com', undefined, '50', cursor);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws_1',
        endUserId: 'test@example.com',
        status: { not: 'disconnected' },
        id: { lt: 4210n },
      },
      orderBy: { id: 'desc' },
      take: 51,
    });
  });

  it('emits has_more + next_cursor when more rows exist past the page', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    // 3 rows requested, 4 returned → has_more=true; cursor is the 3rd id.
    prisma.account.findMany.mockResolvedValue([
      { id: 30n, platform: 'tiktok', handle: 'a', displayName: null, status: 'ready' },
      { id: 29n, platform: 'tiktok', handle: 'b', displayName: null, status: 'ready' },
      { id: 28n, platform: 'tiktok', handle: 'c', displayName: null, status: 'ready' },
      { id: 27n, platform: 'tiktok', handle: 'd', displayName: null, status: 'ready' },
    ]);
    const res = await controller.list('demo', 'test@example.com', undefined, '3', undefined);
    expect(res.data).toHaveLength(3);
    expect(res.meta.has_more).toBe(true);
    expect(res.meta.next_cursor).toBe(
      Buffer.from('28', 'utf8').toString('base64url'),
    );
  });

  it('rejects when ws_slug is missing', async () => {
    await expect(
      controller.list('', 'test@example.com', undefined, undefined, undefined),
    ).rejects.toThrow();
    expect(workspaces.findBySlug).not.toHaveBeenCalled();
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });
});
