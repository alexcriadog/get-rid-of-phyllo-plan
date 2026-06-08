import { Module } from "@nestjs/common";
import { SharedDatabaseModule } from "@shared/database/database.module";
import { PhylloCredentialsService } from "./phyllo-credentials.service";
import { PhylloBasicAuthGuard } from "./basic-auth.guard";
import { PhylloAccountResolver } from "./phyllo-account-resolver.service";
import { PhylloReadService } from "./phyllo-read.service";
import { PhylloAccountsController } from "./phyllo-accounts.controller";
import { PhylloDataController } from "./phyllo-data.controller";

/**
 * Phyllo (InsightIQ) compatible read API. Basic-auth, workspace-scoped,
 * serves the dual-written phyllo_* Mongo docs verbatim so a consumer can
 * switch off Phyllo by changing only base URL + credentials.
 * See PLAN-phyllo-schema-alignment.md.
 */
@Module({
  imports: [SharedDatabaseModule],
  controllers: [PhylloAccountsController, PhylloDataController],
  providers: [
    PhylloCredentialsService,
    PhylloBasicAuthGuard,
    PhylloAccountResolver,
    PhylloReadService,
  ],
  exports: [PhylloCredentialsService],
})
export class PhylloApiModule {}
