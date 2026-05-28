// Single source of truth catalog for connect-tool and the admin UI.
//
// connect-tool (Next.js, same host behind Caddy) fetches this at request time
// from /api/oauth/[slug]/start to compute the minimal OAuth scope set per
// workspace using PLATFORM_CATALOG[platform][product].scopes. The admin UI
// fetches it from getServerSideProps to render the product-selection grid.
//
// Unguarded by design: the catalog is static, identical for every customer,
// and consists entirely of public information (the platforms we support,
// product labels, and the OAuth scope strings that already appear on every
// provider's consent screen). No workspace-specific data, no secrets — so
// the operational cost of distributing CONNECT_TOOL_SECRET to every Next.js
// container that does SSR isn't worth it. If the catalog ever starts
// carrying sensitive material, re-introduce @UseGuards(ConnectToolGuard).

import { Controller, Get } from '@nestjs/common';
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
  get(): CatalogResponse {
    return {
      platforms: PLATFORM_IDS,
      products: PRODUCT_IDS,
      catalog: PLATFORM_CATALOG,
    };
  }
}
