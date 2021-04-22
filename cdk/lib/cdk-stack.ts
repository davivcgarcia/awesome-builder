import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ssm from '@aws-cdk/aws-ssm';
import * as rds from '@aws-cdk/aws-rds';
import * as ecr_assets from '@aws-cdk/aws-ecr-assets';
import * as as from '@aws-cdk/aws-autoscaling';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as synthetics from '@aws-cdk/aws-synthetics';
import * as logs from '@aws-cdk/aws-logs';

import * as fs from 'fs';

export class OctankDemoStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Basic VPC with 2 AZs

    const vpc = new ec2.Vpc(this, 'OctankVPC', {
      maxAzs: 2,
    });

    // Application Load Balancer for the application components

    const octankExtALB = new elbv2.ApplicationLoadBalancer(this, "OctankExtALB", {
      vpc: vpc,
      internetFacing: true
    });

    const octankExtALBListener = octankExtALB.addListener("OctankExtALBListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: "Invalid URI"
      })
    });

    // Application Load Balancer for the application components

    const octankIntALB = new elbv2.ApplicationLoadBalancer(this, "OctankIntALB", {
      vpc: vpc,
      internetFacing: false
    });

    const octankIntALBListener = octankIntALB.addListener("OctankIntALBListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: "Invalid URI"
      })
    });

    // IAM Role for EC2

    const nodejsEc2Role = new iam.Role(this, 'OctankEC2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    nodejsEc2Role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
    });
    nodejsEc2Role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess',
    });
    nodejsEc2Role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
    });

    // NodeJS Backend Container Image on ECR

    const nodejsImage = new ecr_assets.DockerImageAsset(this, 'NodejsBackendImage', {
      directory: '../nodejs-backend',
    });

    nodejsImage.repository.grantPull(nodejsEc2Role);

    // Security Group for the EC2 hosting NodeJS Backend

    const nodejsSecGrp = new ec2.SecurityGroup(this, "NodejsBackendSecGrp", {
      allowAllOutbound: true,
      securityGroupName: "NodejsBackendSecGrp",
      vpc: vpc
    });

    // NodeJS Backend Log Group

    const nodejsLogGrp = new logs.LogGroup(this, 'OctankNodejsBackendLogGrp', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
      logGroupName: '/octank/ec2/nodejsbackend'
    });

    nodejsLogGrp.grantWrite(nodejsEc2Role)

    // SSM Parameter Store for EC2 CloudWatch Agent

    const ec2CWAgentConfig = new ssm.StringParameter(this, 'ec2-cwagent-config', {
      parameterName: `/${this.stackName}/CloudWatch/EC2AgentConfig`,
      description: 'Configuration for the CloudWatch Agent used with EC2',
      stringValue: fs.readFileSync('assets/ec2-cwagent-config.json', 'utf-8')
                     .replace(/%LOG_GROUP_NAME_PLACEHOLDER%/g, nodejsLogGrp.logGroupName)
    });

    nodejsSecGrp.connections.allowInternally(ec2.Port.tcp(3000));

    // NodeJS EC2 User Data (dynamically generated)

    const nodejsUserData = fs.readFileSync('assets/ec2-userdata-nodejs.sh', 'utf-8')
      .replace(/%IMAGE_URI_PLACEHOLDER%/g, nodejsImage.imageUri)
      .replace(/%PARAMETER_NAME_PLACEHOLDER%/g, ec2CWAgentConfig.parameterName);

    // NodeJS Backend ASG

    const nodejsASG = new as.AutoScalingGroup(this, 'NodejsASG', {
      vpc: vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      desiredCapacity: 2,
      role: nodejsEc2Role,
      securityGroup: nodejsSecGrp,
      userData: ec2.UserData.custom(nodejsUserData),
      instanceMonitoring: as.Monitoring.DETAILED
    });

    // ALB Target for the NodeJS Backend on ASG

    octankIntALBListener.addTargets("NodejsBackendTarget", {
      priority: 20,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/api/v1/image*"])
      ],
      healthCheck: {
        path: '/healthz/',
        unhealthyThresholdCount: 3
      },
      targets: [nodejsASG]
    });

    // ECS Cluster with Container Insight enabled

    const demoCluster = new ecs.Cluster(this, 'DemoCluster', {
      vpc: vpc,
      containerInsights: true,
      clusterName: 'democluster'
    });

    // IAM Roles for ECS Task Definitions

    const taskRole = new iam.Role(this, 'OctankECSTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess',
    });
    taskRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
    });
    taskRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'ec2:DescribeInstances',
        'ecs:ListTasks',
        'ecs:ListServices',
        'ecs:DescribeContainerInstances',
        'ecs:DescribeServices',
        'ecs:DescribeTasks',
        'ecs:DescribeTaskDefinition',
      ],
    }));

    const executionRole = new iam.Role(this, 'OctankECSExecutionkRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    executionRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    });
    executionRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess',
    });
    executionRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
    });

    // SSM Parameter Store for the ECS CloudWatch Agent used in ECS Task Definitions

    const ecsCWAgentConfig = new ssm.StringParameter(this, 'octank-cloudwatch-agent-config', {
      parameterName: `/${this.stackName}/CloudWatch/ECSAgentConfig`,
      stringValue: fs.readFileSync('assets/ecs-cwagent-config.json', 'utf-8'),
      description: 'Configuration for the CloudWatch Agent'
    });

    // SSM Parameter Store for ECS CloudWatch Agent Prometheus Scraping

    const ecsCWAgentPrometheusConfig = new ssm.StringParameter(this, 'octank-cloudwatch-prometheus-config', {
      parameterName: `/${this.stackName}/CloudWatch/ECSPrometheusConfig`,
      stringValue: fs.readFileSync('assets/ecs-cwagent-prometheus.yaml', 'utf-8'),
      description: 'Configuration for the CloudWatch Prometheus Scrapping'
    });

    // RDS Instance for SpringBoot Backend

    const rdsSecGrp = new ec2.SecurityGroup(this, 'RDSSecGrp', {
      vpc: vpc,
      allowAllOutbound: true,
    });

    rdsSecGrp.connections.allowInternally(ec2.Port.tcp(3306));

    const octankRdsInstance = new rds.DatabaseInstance(this, 'OctankRdsInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7_33
      }),
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      multiAz: true,
      databaseName: 'springboot_db',
      securityGroups: [rdsSecGrp],
      publiclyAccessible: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Springboot Backend Container Image on ECR

    const springbootDbInitImage = new ecr_assets.DockerImageAsset(this, 'SpringBootDbInitImage', {
      directory: '../springboot-db-init',
    });

    const springbootBackendImage = new ecr_assets.DockerImageAsset(this, 'SpringBootBackendImage', {
      directory: '../springboot-backend',
    });

    // Springboot Backend Log Group

    const springbootLogGrp = new logs.LogGroup(this, 'OctankSpringBootBackendLogGrp', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
      logGroupName: '/octank/ecs/service/springbootbackend'
    });

    // SpringBoot Backend ECS Task Definition (with X-Ray Daemon and CloudWatch Agent)

    const springbootTaskDef = new ecs.FargateTaskDefinition(this, 'SpringBootBackend', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole: taskRole,
      executionRole: executionRole
    });

    const dbInitContainer = springbootTaskDef.addContainer('db-init', {
      image: ecs.ContainerImage.fromDockerImageAsset(springbootDbInitImage),
      essential: false,
      secrets: {
        'DATABASE_HOST': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'host'),
        'DATABASE_PORT': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'port'),
        'DATABASE_USERNAME': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'username'),
        'DATABASE_PASSWORD': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'password'),
        'DATABASE_NAME': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'dbname')
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: springbootLogGrp
      }),
    });

    springbootTaskDef.addContainer('application', {
      image: ecs.ContainerImage.fromDockerImageAsset(springbootBackendImage),
      cpu: 768,
      memoryReservationMiB: 1536,
      portMappings: [{
        containerPort: 8080,
      }],
      environment: {
        'AWS_XRAY_TRACING_NAME': 'SpringBootBackend',
      },
      secrets: {
        'DATABASE_HOST': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'host'),
        'DATABASE_PORT': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'port'),
        'DATABASE_USERNAME': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'username'),
        'DATABASE_PASSWORD': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'password'),
        'DATABASE_NAME': ecs.Secret.fromSecretsManager(octankRdsInstance.secret!, 'dbname')
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: springbootLogGrp
      }),
      dockerLabels: {
        'ECS_PROMETHEUS_JOB_NAME': 'SpringBootBackend',
        'ECS_PROMETHEUS_METRICS_PATH': '/actuator/prometheus',
        'ECS_PROMETHEUS_EXPORTER_PORT': '8080',
        'JAVA_EMF_EXPORT': 'true'
      },
    }).addContainerDependencies({
      container: dbInitContainer,
      condition: ecs.ContainerDependencyCondition.COMPLETE
    });

    springbootTaskDef.addContainer('xray-daemon', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest'),
      cpu: 128,
      memoryReservationMiB: 256,
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: springbootLogGrp 
      }),
    });

    springbootTaskDef.addContainer('cloudwatch-agent', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest'),
      cpu: 128,
      memoryReservationMiB: 256,
      secrets: {
        'CW_CONFIG_CONTENT': ecs.Secret.fromSsmParameter(ecsCWAgentConfig),
        'PROMETHEUS_CONFIG_CONTENT': ecs.Secret.fromSsmParameter(ecsCWAgentPrometheusConfig)
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: springbootLogGrp
      }),
    });

    // Security Group for SpringBoot Backend ECS Service

    const springbootSecGrp = new ec2.SecurityGroup(this, "SpringBootBackendSecGrp", {
      allowAllOutbound: true,
      securityGroupName: "SpringBootBackendSecGrp",
      vpc: vpc
    });

    springbootSecGrp.connections.allowInternally(ec2.Port.tcp(8080));

    // Include a Ingress Rule for the SpringBootBackendSecGrp in the RDS Instance

    rdsSecGrp.connections.allowFrom(springbootSecGrp, ec2.Port.tcp(3306));

    // ECS Service for SpringBoot Backend

    const springbootSrv = new ecs.FargateService(this, "SpringBootBackendSrv", {
      cluster: demoCluster,
      taskDefinition: springbootTaskDef,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      securityGroups: [springbootSecGrp]
    });

    // ALB TargetGroup for the SpringBoot Backend Service

    octankIntALBListener.addTargets("SpringBootBackendTarget", {
      priority: 10,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/api/v1/favorite*"])
      ],
      healthCheck: {
        path: '/actuator/health/',
        unhealthyThresholdCount: 3
      },
      targets: [springbootSrv]
    });

    // DotNet Frontend Container Image on ECR

    const dotnetImage = new ecr_assets.DockerImageAsset(this, 'DotnetFrontendImage', {
      directory: '../dotnet-frontend',
    });

    // DotNet Frontend Log Group

    const dotnetLogGrp = new logs.LogGroup(this, 'OctankDotnetFrontendLogGrp', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
      logGroupName: '/octank/ecs/service/dotnetfrontend'
    });

    // DotNet Frontend ECS Task Definition (with X-Ray Daemon and CloudWatch Agent)

    const dotnetTaskDef = new ecs.FargateTaskDefinition(this, 'DotnetFrontend', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: taskRole,
      executionRole: executionRole
    });

    dotnetTaskDef.addContainer('application', {
      image: ecs.ContainerImage.fromDockerImageAsset(dotnetImage),
      cpu: 128,
      memoryReservationMiB: 256,
      portMappings: [{
        containerPort: 80,
      }],
      environment: {
        'IMAGE_BACKEND': `http://${octankIntALB.loadBalancerDnsName}/api/v1/image/`,
        'FAVORITE_BACKEND': `http://${octankIntALB.loadBalancerDnsName}/api/v1/favorite/`,
        'AWS_XRAY_TRACING_NAME': 'DotnetFrontend'
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: dotnetLogGrp
      }),
    });

    dotnetTaskDef.addContainer('xray-daemon', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest'),
      cpu: 64,
      memoryReservationMiB: 128,
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: dotnetLogGrp
      }),
    });

    dotnetTaskDef.addContainer('cloudwatch-agent', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest'),
      cpu: 64,
      memoryReservationMiB: 128,
      secrets: {
        'CW_CONFIG_CONTENT': ecs.Secret.fromSsmParameter(ecsCWAgentConfig),
        'PROMETHEUS_CONFIG_CONTENT': ecs.Secret.fromSsmParameter(ecsCWAgentPrometheusConfig)
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'container',
        logGroup: dotnetLogGrp
      }),
    });

    // Security Group for SpringBoot Backend ECS Service

    const dotnetSecGrp = new ec2.SecurityGroup(this, "DotnetFrontendSecGrp", {
      allowAllOutbound: true,
      securityGroupName: "DotnetFrontendSecGrp",
      vpc: vpc
    });

    dotnetSecGrp.connections.allowInternally(ec2.Port.tcp(80));

    // ECS Service for SpringBoot Backend

    const dotnetSrv = new ecs.FargateService(this, "DotnetFrontendSrv", {
      cluster: demoCluster,
      taskDefinition: dotnetTaskDef,
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      securityGroups: [dotnetSecGrp],
    });

    // ALB TargetGroup for the SpringBoot Backend Service

    octankExtALBListener.addTargets("DotnetFrontendTarget", {
      priority: 30,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/*"])
      ],
      healthCheck: {
        port: "80",
        path: '/',
        unhealthyThresholdCount: 3
      },
      targets: [dotnetSrv]
    });

    // CloudWatch Synthetics Canaries for generating traffic

    const canaryRandom = new synthetics.Canary(this, 'CanaryRandom', {
      canaryName: 'canary-random',
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(1)),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(
          fs.readFileSync('assets/cw-synthetic-handler.js', 'utf-8')
            .replace('%URL_PLACEHOLDER%', `http://${octankExtALB.loadBalancerDnsName}/Home/Random/`)
        ),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_3_1,
    });

    const canaryFavorite = new synthetics.Canary(this, 'CanaryFavorite', {
      canaryName: 'canary-favorite',
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(1)),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(
          fs.readFileSync('assets/cw-synthetic-handler.js', 'utf-8')
            .replace('%URL_PLACEHOLDER%', `http://${octankExtALB.loadBalancerDnsName}/Home/Favorite/`)
        ),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_3_1,
    });

    const canaryDontExist = new synthetics.Canary(this, 'CanaryDontExist', {
      canaryName: 'canary-dontexist',
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(
          fs.readFileSync('assets/cw-synthetic-handler.js', 'utf-8')
            .replace('%URL_PLACEHOLDER%', `http://${octankExtALB.loadBalancerDnsName}/DontExist/`)
        ),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_3_1,
    });

    // Generating CloudFormation Outputs for the user

    new cdk.CfnOutput(this, "External ALB (frontend)", {
      value: `http://${octankExtALB.loadBalancerDnsName}`
    });

    new cdk.CfnOutput(this, "Internal ALB (backends)", {
      value: `http://${octankIntALB.loadBalancerDnsName}`
    });

    new cdk.CfnOutput(this, "RDS Instance URI", {
      value: `mysql://${octankRdsInstance.dbInstanceEndpointAddress}:${octankRdsInstance.dbInstanceEndpointPort}`
    });

    new cdk.CfnOutput(this, "DotNet Frontend Container Image", {
      value: dotnetImage.imageUri
    });

    new cdk.CfnOutput(this, "NodeJs Backend Container Image", {
      value: nodejsImage.imageUri
    });

    new cdk.CfnOutput(this, "Springboot Backend Container Image", {
      value: springbootBackendImage.imageUri
    });

    new cdk.CfnOutput(this, "Springboot DB-Init Container Image", {
      value: springbootDbInitImage.imageUri
    });

  }
}