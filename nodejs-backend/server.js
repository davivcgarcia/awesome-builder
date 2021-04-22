// Configure X-Ray SDK
const AWSXRay = require('aws-xray-sdk');
const XRayExpress = AWSXRay.express;
AWSXRay.config([AWSXRay.plugins.EC2Plugin]);

// Capture all AWS clients
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
AWS.config.update({ region: process.env.DEFAULT_AWS_REGION || 'us-east-1' });

// Capture all outgoing https requests
AWSXRay.captureHTTPsGlobal(require('https'));
AWSXRay.capturePromise()
const https = require('https');

// Imports
const fs = require('fs');
const express = require('express');
const logger = require('morgan');

// Configure Express with Morgan
const port = 3000;
const app = express();

// Configure logging subsystem
app.use(logger('combined', {
  stream: fs.createWriteStream('./access.log')
}));
app.use(logger('combined'));

// Include X-Ray middleware for tracing
app.use(XRayExpress.openSegment('NodejsBackend'));

app.get('/healthz', (req, res) => {
  res.status(200).send('Ok');
});

const serviceConfigs = [
  {
    type: 'fox',
    options: {
      hostname: 'randomfox.ca',
      port: 443,
      path: '/floof/',
      method: 'GET'
    },
    key: 'image'
  },
  {
    type: 'cat',
    options: {
      hostname: 'aws.random.cat',
      port: 443,
      path: '/meow',
      method: 'GET'
    },
    key: 'file'
  }
];

app.get('/api/v1/image', (req, res) => {

  const randomConfig = serviceConfigs[Math.floor(Math.random() * serviceConfigs.length)]

  const httpReq = https.request(randomConfig.options, httpRes => {
    httpRes.on('data', data => {
      const resObj = {
        imageType: randomConfig.type,
        imageUrl: JSON.parse(data)[randomConfig.key]
      }
      res.json(resObj)
    });
  })
  httpReq.end()

});

app.use(XRayExpress.closeSegment());

app.listen(port, () => console.log(`Application listening on port ${port}!`));