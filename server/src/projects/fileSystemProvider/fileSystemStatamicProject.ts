import * as path from "path";
import * as fs from "fs";
import * as YAML from "yaml";

import { dirname } from "path";
import { IComposerPackage } from '../../composer/composerPackage';
import { LockFileParser } from '../../composer/lockFileParser';
import { convertPathToUri, shouldProcessPath } from '../../utils/io';
import { IAssets } from '../assets/asset';
import { IBlueprintField } from '../blueprints/fields';
import { ICollection } from '../collections/collection';
import { ICollectionScope } from '../collections/collectionScope';
import { IFieldsetField } from '../fieldsets/fieldset';
import { INavigation } from '../navigations/navigation';
import { ITemplate } from '../templates';
import { IUserGroup, IUserRole } from '../users/users';
import { IView } from '../views/view';
import { getBlueprintFields } from './blueprints';
import { getFieldsetFields } from './fieldsets';
import { getNavigationMenu } from './navigationMenus';
import { getProjectAssets } from './projectAssets';
import { getCollectionDetails } from './projectCollections';
import { getUserRoles, getUserGroups } from './userPermissions';
import { IProjectDetailsProvider } from '../projectDetailsProvider';
import { JsonSourceProject } from '../jsonSourceProject';
import { normalizePath } from '../../utils/uris';
import { replaceAllInString } from '../../utils/strings';

function getRootProjectPath(path: string): string {
    const parts = normalizePath(path).split("/");
    const newParts = [];
    let lastPart = null;

    for (let i = 0; i < parts.length; i++) {
        if (i == 0) {
            lastPart = parts[i];
            newParts.push(parts[i]);
            continue;
        }

        if (parts[i] == "views" && lastPart == "resources") {
            break;
        }

        newParts.push(parts[i]);
        lastPart = parts[i];
    }

    return newParts.join("/");
}

function getLaravelRoot(root: string): string {
    if (root.endsWith("/") == false) {
        root = root + "/";
    }
    return root + "../";
}

function getComposerLockFile(laravelRoot: string): string {
    return laravelRoot + "composer.lock";
}

function getComposerVendorDirectory(laravelRoot: string): string {
    return laravelRoot + "vendor/";
}

function makeCollectionsDirectory(root: string): string {
    return root + "/blueprints/collections/";
}

function makeTaxonomyBlueprintsDirectory(root: string): string {
    return root + "/blueprints/taxonomies/";
}

function makeAssetsBlueprintDirectory(root: string): string {
    return root + "/blueprints/assets/";
}

function makeGlobalSettingsBlueprintsDirectory(root: string): string {
    return root + "/blueprints/globals/";
}

function makeFormsBlueprintsDirectory(root: string): string {
    return root + "/blueprints/forms/";
}

function makeMiscBlueprintsDirectory(root: string): string {
    return root + "/blueprints/";
}

function makeMacroFilePath(root: string): string {
    return root + "/macros.yaml";
}

function makeViewsDirectory(root: string): string {
    return root + "/views/";
}

function makeUserPermissionsDirectory(root: string): string {
    return root + "/users/";
}

function makeFormsDirectory(root: string): string {
    return root + "/forms/";
}

function makeFieldsetsDirectory(root: string): string {
    return root + "/fieldsets";
}

function makeContentDirectory(root: string): string {
    return root + "/../content/";
}

function makeAssetsContentDirectory(root: string): string {
    return makeContentDirectory(root) + "assets/";
}

function makeCollectionsContentDirectory(root: string): string {
    return makeContentDirectory(root) + "collections/";
}

function makeTaxonomyTermsDirectory(root: string): string {
    return makeContentDirectory(root) + "taxonomies/";
}

function makeNavigationDirectory(root: string): string {
    return makeContentDirectory(root) + "navigation/";
}

function getFiles(
    startPath: string,
    filter: string,
    foundFiles: string[]
): string[] {
    if (!fs.existsSync(startPath)) {
        return [];
    }

    let returnFiles = foundFiles || [];
    const files = fs.readdirSync(startPath);

    for (let i = 0; i < files.length; i++) {
        const filename = path.join(startPath, files[i]);
        const stat = fs.lstatSync(filename);

        if (stat.isDirectory()) {
            returnFiles = returnFiles.concat(getFiles(filename, filter, foundFiles));
        } else if (filename.indexOf(filter) >= 0) {
            returnFiles.push(filename);
        }
    }

    return [...new Set(returnFiles)];
}

export function getDirectFiles(startPath: string, filter: string): string[] {
    if (!fs.existsSync(startPath)) {
        return [];
    }

    const returnFiles = [];
    const files = fs.readdirSync(startPath);

    for (let i = 0; i < files.length; i++) {
        const filename = path.join(startPath, files[i]);
        const stat = fs.lstatSync(filename);

        if (stat.isDirectory() == false) {
            returnFiles.push(filename);
        }
    }

    return [...new Set(returnFiles)];
}

function getProjectViews(viewPath: string): IView[] {
    const files = getFiles(viewPath, ".html", []),
        sourcePathLen = viewPath.length,
        views: IView[] = [];

    for (let i = 0; i < files.length; i++) {
        const thisFile = files[i],
            relativePath = thisFile.substr(sourcePathLen),
            relativeDirName: string = normalizePath(path.dirname(relativePath)),
            fileName: string = path.basename(relativePath);
        let workingFileName: string = fileName,
            isPartial = false,
            isAntlers = false,
            isBlade = false,
            displayName = "";

        // Allows non .antlers.html files to be flagged as partials.
        if (fileName.startsWith("_")) {
            isPartial = true;
            workingFileName = workingFileName.substr(1);
        }

        if (fileName.endsWith(".antlers.html")) {
            isAntlers = true;

            workingFileName = workingFileName.substr(0, workingFileName.length - 13);
        } else if (fileName.endsWith(".blade.php")) {
            isAntlers = false;
            isBlade = true;
        } else {
            isAntlers = false;
            isBlade = false;
        }

        if (relativeDirName != ".") {
            displayName = relativeDirName + "/" + workingFileName;
        } else {
            displayName = workingFileName;
        }

        views.push({
            displayName: workingFileName,
            fileName: fileName,
            documentUri: convertPathToUri(thisFile),
            originalDocumentUri: convertPathToUri(thisFile),
            isAntlers: isAntlers,
            isBlade: isBlade,
            isPartial: isPartial,
            path: normalizePath(thisFile),
            relativeDisplayName: displayName,
            relativeFileName: fileName,
            relativePath: relativePath,
            injectsCollections: [],
            injectsParameters: [],
            templateName: replaceAllInString(displayName, '/', '.'),
            varReferenceNames: new Map(),
        });
    }

    return views;
}

export function getProjectStructure(resourcePath: string): FileSystemStatamicProject {
    const projectPath = getRootProjectPath(resourcePath),
        collectionsDirectory = makeCollectionsDirectory(projectPath),
        viewsDirectory = makeViewsDirectory(projectPath),
        formsDirectory = makeFormsDirectory(projectPath),
        formsBlueprintDirectory = makeFormsBlueprintsDirectory(projectPath),
        fieldsetsDirectory = makeFieldsetsDirectory(projectPath),
        taxonomiesDirectory = makeTaxonomyBlueprintsDirectory(projectPath),
        globalSettingsDirectory =
            makeGlobalSettingsBlueprintsDirectory(projectPath),
        miscBlueprintsDirectory = makeMiscBlueprintsDirectory(projectPath),
        contentDirectory = makeContentDirectory(projectPath),
        navigationDirectory = makeNavigationDirectory(projectPath),
        taxonomyContentDirectory = makeTaxonomyTermsDirectory(projectPath),
        userPermissionsDirectory = makeUserPermissionsDirectory(projectPath),
        collectionContentDirectory = makeCollectionsContentDirectory(projectPath),
        assetsContentDirectory = makeAssetsContentDirectory(projectPath),
        assetsBlueprintDirectory = makeAssetsBlueprintDirectory(projectPath),
        blueprintsPaths = getFiles(collectionsDirectory, ".yaml", []),
        projectViews = getProjectViews(viewsDirectory),
        macroFilePath = makeMacroFilePath(projectPath),
        laravelRoot = getLaravelRoot(projectPath),
        composerLock = getComposerLockFile(laravelRoot),
        vendorDirectory = getComposerVendorDirectory(laravelRoot);
    let hasMacroFile = false;

    let statamicPackage: IComposerPackage | null = null;

    const composerPackages = LockFileParser.getInstalledPackages(
        composerLock,
        laravelRoot,
        vendorDirectory
    );

    for (let i = 0; i < composerPackages.length; i++) {
        if (composerPackages[i].name == "statamic/cms") {
            statamicPackage = composerPackages[i];
            break;
        }
    }

    const fieldsets: Map<string, IFieldsetField[]> = new Map();
    const pluralizedTaxonomyNames: Map<string, string> = new Map();
    const formsMapping: Map<string, IBlueprintField[]> = new Map();
    const globalsMapping: Map<string, IBlueprintField[]> = new Map();
    const taxonomyMapping: Map<string, IBlueprintField[]> = new Map();
    const miscFields: Map<string, IBlueprintField[]> = new Map();
    const templates: ITemplate[] = [];
    const fieldMapping: Map<string, IBlueprintField[]> = new Map();
    const discoveredCollectionNames: string[] = [];
    const discoveredTaxonomyNames: string[] = [];
    const partialCache: IView[] = [];
    const partialNames: string[] = [];
    const collectionScopes: ICollectionScope[] = [];
    const taxonomyTerms: Map<string, string[]> = new Map();

    const userGroups: Map<string, IUserGroup> = new Map(),
        userGroupNames: string[] = [],
        userRoles: Map<string, IUserRole> = new Map(),
        userRoleNames: string[] = [],
        navigationItems: Map<string, INavigation> = new Map(),
        collections: Map<string, ICollection> = new Map(),
        assets: Map<string, IAssets> = new Map(),
        assetFields: Map<string, IBlueprintField[]> = new Map();

    if (macroFilePath.trim().length > 0) {
        hasMacroFile = fs.existsSync(macroFilePath);
    }

    // Views.

    for (let i = 0; i < projectViews.length; i++) {
        if (projectViews[i].isPartial) {
            partialCache.push(projectViews[i]);
            partialNames.push(projectViews[i].relativeDisplayName);
        }
    }

    // Assets.
    const assetPaths = getDirectFiles(assetsContentDirectory, ".yaml");

    for (let i = 0; i < assetPaths.length; i++) {
        if (shouldProcessPath(assetPaths[i])) {
            const asset = getProjectAssets(assetPaths[i]);

            assets.set(asset.handle, asset);
        }
    }

    // Collection details.
    const collectionPaths = getDirectFiles(collectionContentDirectory, ".yaml");

    for (let i = 0; i < collectionPaths.length; i++) {
        if (shouldProcessPath(collectionPaths[i])) {
            const collection = getCollectionDetails(collectionPaths[i]);

            collections.set(collection.handle, collection);
        }
    }

    // User roles and groups.
    const rolesPath = userPermissionsDirectory + "roles.yaml",
        groupsPath = userPermissionsDirectory + "groups.yaml";

    if (fs.existsSync(rolesPath)) {
        const roles = getUserRoles(rolesPath);

        for (let i = 0; i < roles.length; i++) {
            userRoles.set(roles[i].handle, roles[i]);
            userRoleNames.push(roles[i].handle);
        }
    }

    if (fs.existsSync(groupsPath)) {
        const groups = getUserGroups(groupsPath);

        for (let i = 0; i < groups.length; i++) {
            userGroups.set(groups[i].handle, groups[i]);
            userGroupNames.push(groups[i].handle);
        }
    }

    // Gather up the fieldsets.
    const fieldsetPaths = getFiles(fieldsetsDirectory, ".yaml", []);
    let allBlueprintFields: IBlueprintField[] = [];

    for (let i = 0; i < fieldsetPaths.length; i++) {
        if (shouldProcessPath(fieldsetPaths[i])) {
            const fieldsetName = path
                .basename(fieldsetPaths[i])
                .split(".")
                .slice(0, -1)
                .join(".");

            if (fieldsetName != null && fieldsetName.trim().length > 0) {
                const fields = getFieldsetFields(fieldsetPaths[i], fieldsetName);

                fieldsets.set(fieldsetName, fields);
            }
        }
    }

    // Taxonomies.
    const taxonomyPaths = getFiles(taxonomiesDirectory, ".yaml", []);

    for (let i = 0; i < taxonomyPaths.length; i++) {
        if (shouldProcessPath(taxonomyPaths[i])) {
            const taxonomyName = path
                .basename(taxonomyPaths[i])
                .split(".")
                .slice(0, -1)
                .join("."),
                pluralForm = path.basename(path.dirname(taxonomyPaths[i]));

            if (taxonomyName != null && taxonomyName.trim().length > 0) {
                pluralizedTaxonomyNames.set(taxonomyName, pluralForm);

                const fields = getBlueprintFields(
                    taxonomyPaths[i],
                    taxonomyName,
                    fieldsets
                );

                taxonomyMapping.set(taxonomyName, fields);
                allBlueprintFields = allBlueprintFields.concat(fields);

                if (discoveredTaxonomyNames.includes(taxonomyName) == false) {
                    discoveredTaxonomyNames.push(taxonomyName);
                }
            }
        }
    }

    // Build up a list of relevant taxonomy terms.
    if (discoveredTaxonomyNames.length > 0) {
        for (let i = 0; i < discoveredTaxonomyNames.length; i++) {
            // We need to locate the plural form to use instead
            // "topic" becomes "topics" - so we need to use
            // that when we build a basic list of terms.
            if (pluralizedTaxonomyNames.has(discoveredTaxonomyNames[i])) {
                const pluralTaxonomyName = pluralizedTaxonomyNames.get(
                    discoveredTaxonomyNames[i]
                );

                if (
                    typeof pluralTaxonomyName !== "undefined" &&
                    pluralTaxonomyName !== null
                ) {
                    const termLocation =
                        taxonomyContentDirectory + pluralTaxonomyName + "/";

                    if (fs.existsSync(termLocation)) {
                        const terms = getDirectFiles(termLocation, ".yaml"),
                            discoveredTerms: string[] = [];

                        for (let j = 0; j < terms.length; j++) {
                            if (shouldProcessPath(terms[j])) {
                                const termName = path
                                    .basename(terms[j])
                                    .split(".")
                                    .slice(0, -1)
                                    .join(".");

                                discoveredTerms.push(termName);
                            }
                        }

                        taxonomyTerms.set(discoveredTaxonomyNames[i], discoveredTerms);
                    }
                }
            }
        }
    }

    // Base level blueprints.
    const miscBlueprintPaths = getDirectFiles(miscBlueprintsDirectory, ".yaml");

    for (let i = 0; i < miscBlueprintPaths.length; i++) {
        if (shouldProcessPath(miscBlueprintPaths[i])) {
            const blueprintName = path
                .basename(miscBlueprintPaths[i])
                .split(".")
                .slice(0, -1)
                .join(".");

            if (blueprintName != null && blueprintName.trim().length > 0) {
                const fields = getBlueprintFields(
                    miscBlueprintPaths[i],
                    blueprintName,
                    fieldsets
                );

                miscFields.set(blueprintName, fields);
                allBlueprintFields = allBlueprintFields.concat(fields);
            }
        }
    }

    for (let i = 0; i < blueprintsPaths.length; i++) {
        if (shouldProcessPath(blueprintsPaths[i])) {
            let blueprintName = path
                .basename(blueprintsPaths[i])
                .split(".")
                .slice(0, -1)
                .join(".");
            const fields = getBlueprintFields(
                blueprintsPaths[i],
                blueprintName,
                fieldsets
            );
            const collectionName = normalizePath(dirname(blueprintsPaths[i]))
                .split("/")
                .pop();

            allBlueprintFields = allBlueprintFields.concat(fields);

            if (collectionName != null && collectionName.trim().length > 0) {
                blueprintName = collectionName;
                if (discoveredCollectionNames.includes(collectionName) == false) {
                    discoveredCollectionNames.push(collectionName);
                }
            }

            fieldMapping.set(blueprintName, fields);
        }
    }

    // Navigation
    const navPaths = getDirectFiles(navigationDirectory, ".yaml");

    for (let i = 0; i < navPaths.length; i++) {
        if (shouldProcessPath(navPaths[i])) {
            const navigationMenu = getNavigationMenu(navPaths[i]);

            navigationItems.set(navigationMenu.handle, navigationMenu);
        }
    }

    // Globals.
    const globalBlueprintPaths = getDirectFiles(globalSettingsDirectory, ".yaml");

    for (let i = 0; i < globalBlueprintPaths.length; i++) {
        if (shouldProcessPath(globalBlueprintPaths[i])) {
            const globalName = path
                .basename(globalBlueprintPaths[i])
                .split(".")
                .slice(0, -1)
                .join("."),
                fields = getBlueprintFields(
                    globalBlueprintPaths[i],
                    globalName,
                    fieldsets
                );

            allBlueprintFields = allBlueprintFields.concat(fields);

            globalsMapping.set(globalName, fields);
        }
    }

    // Asset Fields.
    if (fs.existsSync(assetsBlueprintDirectory)) {
        const assetBlueprintPathts = getDirectFiles(
            assetsBlueprintDirectory,
            ".yaml"
        );

        for (let i = 0; i < assetBlueprintPathts.length; i++) {
            if (shouldProcessPath(assetBlueprintPathts[i])) {
                const assetName = path
                    .basename(assetBlueprintPathts[i])
                    .split(".")
                    .slice(0, -1)
                    .join("."),
                    fields = getBlueprintFields(
                        assetBlueprintPathts[i],
                        assetName,
                        fieldsets
                    );

                allBlueprintFields = allBlueprintFields.concat(fields);
                assetFields.set(assetName, fields);
            }
        }
    }

    // Forms.
    const formBlueprintPaths = getDirectFiles(formsBlueprintDirectory, ".yaml"),
        allFormDefinitions = getDirectFiles(formsDirectory, ".yaml"),
        formNames: string[] = [];

    for (let i = 0; i < allFormDefinitions.length; i++) {
        if (shouldProcessPath(allFormDefinitions[i])) {
            const formName = path
                .basename(allFormDefinitions[i])
                .split(".")
                .slice(0, -1)
                .join(".");

            if (!formNames.includes(formName)) {
                formNames.push(formName);
            }
        }
    }

    for (let i = 0; i < formBlueprintPaths.length; i++) {
        if (shouldProcessPath(formBlueprintPaths[i])) {
            const formName = path
                .basename(formBlueprintPaths[i])
                .split(".")
                .slice(0, -1)
                .join("."),
                fields = getBlueprintFields(formBlueprintPaths[i], formName, fieldsets);

            allBlueprintFields = allBlueprintFields.concat(fields);
            formsMapping.set(formName, fields);
        }
    }

    for (let i = 0; i < formNames.length; i++) {
        if (!formsMapping.has(formNames[i])) {
            formsMapping.set(formNames[i], []);
        }
    }

    const projectViewMap: Map<string, IView> = new Map();

    for (let i = 0; i < projectViews.length; i++) {
        projectViewMap.set(projectViews[i].relativeDisplayName, projectViews[i]);
    }

    collections.forEach((collection: ICollection, collectionName: string) => {
        if (
            collection.template.trim().length > 0 &&
            projectViewMap.has(collection.template)
        ) {
            const refView = projectViewMap.get(collection.template) as IView;

            refView.injectsCollections.push(collection.handle);
        }
    });

    return new FileSystemStatamicProject({
        composerPackages: composerPackages,
        statamicPackage: statamicPackage,
        isMocked: false,
        workingDirectory: laravelRoot,
        taxonomyPluralizedMapping: pluralizedTaxonomyNames,
        collectionScopes: collectionScopes,
        blueprintFiles: blueprintsPaths,
        collectionBlueprintsPath: collectionsDirectory,
        collections: collections,
        rootPath: projectPath,
        fields: fieldMapping,
        fieldsetsPath: fieldsetsDirectory,
        fieldsets: fieldsets,
        collectionNames: discoveredCollectionNames,
        formBlueprintsPath: formsDirectory,
        taxonomiesBlueprintsPath: taxonomiesDirectory,
        globalBlueprintsPath: globalSettingsDirectory,
        miscBlueprintsPath: miscBlueprintsDirectory,
        viewsPath: viewsDirectory,
        views: projectViews,
        globalFiles: [],
        forms: formsMapping,
        globals: globalsMapping,
        miscFields: miscFields,
        taxonomies: taxonomyMapping,
        taxonomyNames: discoveredTaxonomyNames,
        templates: templates,
        partialCache: partialCache,
        partialViewNames: partialNames,
        macroFilePath: macroFilePath,
        hasMacrosFile: hasMacroFile,
        contentDirectory: contentDirectory,
        taxonomyContentDirectory: taxonomyContentDirectory,
        taxonomyTerms: taxonomyTerms,

        assets: assets,
        assetFields: assetFields,
        oauthProviders: [],
        navigationMenus: navigationItems,

        userPermissionsPath: userPermissionsDirectory,
        userGroupNames: userGroupNames,
        userGroups: userGroups,
        userRoleNames: userRoleNames,
        userRoles: userRoles,
        searchIndexes: [],

        internalFieldReference: allBlueprintFields,
        restoreProperties: null
    }, resourcePath);
}

export class FileSystemStatamicProject extends JsonSourceProject implements IProjectDetailsProvider {

    reloadDetails(): IProjectDetailsProvider {
        return getProjectStructure(this.baseResourcePath);
    }
}
