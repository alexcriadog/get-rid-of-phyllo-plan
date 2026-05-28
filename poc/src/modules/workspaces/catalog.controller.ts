// Single source of truth catalog for connect-tool and the admin UI.
//
// connect-tool (Next.js, same host behind Caddy) fetches this at request time
// from /api/oauth/[slug]/start to compute the minimal OAuth scope set per
// workspace using PLATFORM_CATALOG[platform][product].scopes. The admin UI
// fetches it from getServerSideProps to render the product-selection grid.
//
// Carries ConnectToolGuard so calls from outside the docker network must
// present the shared bearer; loopback (operator curl, local dev without
// CONNECT_TOOL_SECRET) is allowed unconditionally.

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConnectToolGuard } from '@modules/admin/connect-tool.guard';
import {
  PLATFORM_CATALOG,
  PLATFORM_IDS,
  PRODUCT_IDS,
  type Platform,
  type ProductDef,
} from '@modules/accounts/products.catalog';

interface CatalogResponse {
  platforms: ReadonlyArray<Platform>;
  products: ReadonlyArray<string>;
  catalog: Readonly<Record<Platform, ReadonlyArray<ProductDef>>>;
}

@Controller('internal/products-catalog')
export class ProductsCatalogController {
  @Get()
  @UseGuards(ConnectToolGuard)
  get(): CatalogResponse {
    return {
      platforms: PLATFORM_IDS,
      products: PRODUCT_IDS,
      catalog: PLATFORM_CATALOG,
    };
  }
}
