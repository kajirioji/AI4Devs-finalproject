-- Creates the database and the application user with minimal permissions. Idempotent.
-- Variables: $(DB_NAME), $(RECON_APP_PASSWORD) — injected by entrypoint.sh from .env.
IF DB_ID('$(DB_NAME)') IS NULL
BEGIN
    CREATE DATABASE [$(DB_NAME)];
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'recon_app')
BEGIN
    CREATE LOGIN [recon_app] WITH PASSWORD = '$(RECON_APP_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = [$(DB_NAME)];
END;
GO
USE [$(DB_NAME)];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'recon_app')
BEGIN
    CREATE USER [recon_app] FOR LOGIN [recon_app] WITH DEFAULT_SCHEMA = [dbo];
END;
GO
-- Read, write and DDL (for prisma migrate); no db_owner.
ALTER ROLE [db_datareader] ADD MEMBER [recon_app];
ALTER ROLE [db_datawriter] ADD MEMBER [recon_app];
-- A deployment moves DDL to recon_migrator (init.deploy.sql): restarts must not give it back.
IF DATABASE_PRINCIPAL_ID('recon_migrator') IS NULL
BEGIN
    ALTER ROLE [db_ddladmin] ADD MEMBER [recon_app];
END;
GO
-- Read-only user for agents and query tools (DB MCP in --readonly).
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'recon_reader')
BEGIN
    CREATE LOGIN [recon_reader] WITH PASSWORD = '$(RECON_APP_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = [$(DB_NAME)];
END;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'recon_reader')
BEGIN
    CREATE USER [recon_reader] FOR LOGIN [recon_reader] WITH DEFAULT_SCHEMA = [dbo];
    ALTER ROLE [db_datareader] ADD MEMBER [recon_reader];
END;
GO
