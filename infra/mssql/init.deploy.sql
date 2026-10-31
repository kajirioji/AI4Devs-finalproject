-- Deployment only, after init.sql: schema changes move from recon_app to recon_migrator. Idempotent.
-- Variables: $(DB_NAME), $(RECON_MIGRATOR_PASSWORD) — injected by entrypoint.sh, or by hand on an external server.
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'recon_migrator')
BEGIN
    CREATE LOGIN [recon_migrator] WITH PASSWORD = '$(RECON_MIGRATOR_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = [$(DB_NAME)];
END;
GO
USE [$(DB_NAME)];
GO
ALTER ROLE [db_ddladmin] DROP MEMBER [recon_app];
GO
-- Last on purpose: the deployment healthcheck waits for this user.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'recon_migrator')
BEGIN
    CREATE USER [recon_migrator] FOR LOGIN [recon_migrator] WITH DEFAULT_SCHEMA = [dbo];
END;
ALTER ROLE [db_datareader] ADD MEMBER [recon_migrator];
ALTER ROLE [db_datawriter] ADD MEMBER [recon_migrator];
ALTER ROLE [db_ddladmin] ADD MEMBER [recon_migrator];
GO
