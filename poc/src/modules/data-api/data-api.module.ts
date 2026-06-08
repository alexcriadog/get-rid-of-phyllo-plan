import { Module } from "@nestjs/common";
import { SharedDatabaseModule } from "@shared/database/database.module";
import { ApiCredentialsService } from "./credentials.service";
import { ApiBasicAuthGuard } from "./basic-auth.guard";
import { ApiAccountResolver } from "./account-resolver.service";
import { ApiReadService } from "./read.service";
import { DataAccountsController } from "./data-accounts.controller";
import { DataController } from "./data.controller";

/**
 * InsightIQ (InsightIQ) compatible read API. Basic-auth, workspace-scoped,
 * serves the dual-written canonical Mongo docs verbatim so a consumer can
 * switch off InsightIQ by changing only base URL + credentials.
 * See PLAN-canonical-data-api.md.
 */
@Module({
  imports: [SharedDatabaseModule],
  controllers: [DataAccountsController, DataController],
  providers: [
    ApiCredentialsService,
    ApiBasicAuthGuard,
    ApiAccountResolver,
    ApiReadService,
  ],
  exports: [ApiCredentialsService],
})
export class DataApiModule {}
