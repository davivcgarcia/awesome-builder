#!/bin/bash

# System Update
yum update -y
yum install jq -y

# Docker Engine
yum install docker -y
systemctl enable docker --now

# X-Ray Daemon
curl https://s3.us-east-2.amazonaws.com/aws-xray-assets.us-east-2/xray-daemon/aws-xray-daemon-3.x.rpm -o /home/ec2-user/xray.rpm
yum install -y /home/ec2-user/xray.rpm
systemctl enable xray --now

# CloudWatch Agents and CollectD
yum install amazon-cloudwatch-agent -y
amazon-linux-extras install collectd -y

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c ssm:%PARAMETER_NAME_PLACEHOLDER%

# Login to ECR

export ACCOUNT_ID=$(curl --silent http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .accountId)
export REGION=$(curl --silent http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)

aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

# Prepare for containized app deployment
mkdir /var/log/nodejs-backend/ && touch /var/log/nodejs-backend/access.log

# Run containerized NodeJS Backend component
docker run -d --restart always --network host --volume /var/log/nodejs-backend/access.log:/usr/src/app/access.log --name nodejs-backend %IMAGE_URI_PLACEHOLDER%