import * as path from 'path';
import * as cxapi from '@aws-cdk/cx-api';
import { Construct } from 'constructs';
import { AssetManifestReader, DockerImageManifestEntry, FileManifestEntry } from '../private/asset-manifest';
import { isAssetManifest } from '../private/cloud-assembly-internals';
import { AssetType } from './asset-type';
import { FileSet, IFileSet } from './file-set';

export interface StackDeploymentProps {
  readonly stackArtifactId: string;
  readonly stackHierarchicalId: string;
  readonly stackName: string;
  readonly region?: string;
  readonly account?: string;
  readonly assumeRoleArn?: string;
  readonly executionRoleArn?: string;
  readonly tags?: Record<string, string>;
  readonly customCloudAssembly?: IFileSet;
  readonly absoluteTemplatePath: string;
  readonly requiredAssets?: StackAsset[];
}

export class StackDeployment {
  public static fromArtifact(stackArtifact: cxapi.CloudFormationStackArtifact, options: FromArtifactOptions): StackDeployment {
    const artRegion = stackArtifact.environment.region;
    const region = artRegion === cxapi.UNKNOWN_REGION ? undefined : artRegion;
    const artAccount = stackArtifact.environment.account;
    const account = artAccount === cxapi.UNKNOWN_ACCOUNT ? undefined : artAccount;

    return new StackDeployment({
      account,
      region,
      tags: stackArtifact.tags,
      customCloudAssembly: options.customCloudAssembly,
      stackArtifactId: stackArtifact.id,
      stackHierarchicalId: stackArtifact.hierarchicalId,
      stackName: stackArtifact.stackName,
      absoluteTemplatePath: path.join(stackArtifact.assembly.directory, stackArtifact.templateFile),
      assumeRoleArn: stackArtifact.assumeRoleArn,
      executionRoleArn: stackArtifact.cloudFormationExecutionRoleArn,
      requiredAssets: extractStackAssets(stackArtifact),
    });
  }

  public readonly stackArtifactId: string;
  public readonly stackHierarchicalId: string;
  public readonly stackName: string;
  public readonly region?: string;
  public readonly account?: string;
  public readonly assumeRoleArn?: string;
  public readonly executionRoleArn?: string;
  public readonly tags: Record<string, string>;
  public readonly customCloudAssembly?: FileSet;
  public readonly absoluteTemplatePath: string;
  public readonly requiredAssets: StackAsset[];

  public readonly dependsOnStacks: StackDeployment[] = [];

  constructor(props: StackDeploymentProps) {
    this.stackArtifactId = props.stackArtifactId;
    this.stackHierarchicalId = props.stackHierarchicalId;
    this.account = props.account;
    this.region = props.region;
    this.tags = props.tags ?? {};
    this.assumeRoleArn = props.assumeRoleArn;
    this.executionRoleArn = props.executionRoleArn;
    this.stackName = props.stackName;
    this.customCloudAssembly = props.customCloudAssembly?.primaryOutput;
    this.absoluteTemplatePath = props.absoluteTemplatePath;
    this.requiredAssets = props.requiredAssets ?? [];
  }

  public relativeTemplatePath(root: string) {
    return path.relative(root, this.absoluteTemplatePath);
  }

  public addDependency(stackDeployment: StackDeployment) {
    this.dependsOnStacks.push(stackDeployment);
  }
}

export interface FromArtifactOptions {
  readonly scope: Construct;
  readonly customCloudAssembly?: IFileSet;
}

export interface StackAsset {
  /**
   * Absolute asset manifest path
   *
   * This needs to be made relative at a later point in time, but when this
   * information is parsed we don't know about the root cloud assembly yet.
   */
  readonly assetManifestPath: string;

  /**
   * Asset identifier
   */
  readonly assetId: string;

  /**
   * Asset selector to pass to `cdk-assets`.
   */
  readonly assetSelector: string;

  /**
   * Type of asset to publish
   */
  readonly assetType: AssetType;
}

function extractStackAssets(stackArtifact: cxapi.CloudFormationStackArtifact): StackAsset[] {
  const ret = new Array<StackAsset>();

  const assetManifests = stackArtifact.dependencies.filter(isAssetManifest);
  for (const manifestArtifact of assetManifests) {
    const manifest = AssetManifestReader.fromFile(manifestArtifact.file);

    for (const entry of manifest.entries) {
      let assetType: AssetType;
      if (entry instanceof DockerImageManifestEntry) {
        assetType = AssetType.DOCKER_IMAGE;
      } else if (entry instanceof FileManifestEntry) {
        // Don't publishg the template for this stack
        if (entry.source.packaging === 'file' && entry.source.path === stackArtifact.templateFile) {
          continue;
        }

        assetType = AssetType.FILE;
      } else {
        throw new Error(`Unrecognized asset type: ${entry.type}`);
      }

      ret.push({
        assetManifestPath: manifestArtifact.file,
        assetId: entry.id.assetId,
        assetSelector: entry.id.toString(),
        assetType,
      });
    }
  }

  return ret;
}