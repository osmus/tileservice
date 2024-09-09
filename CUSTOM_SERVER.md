# Using a custom server to access the tiles

[OpenStreetMap US](https://openstreetmap.us/) provides map tilesets on Amazon Web Services (AWS). These tilesets are available for use by any project, including commercial usages, by connecting to an OSM US-hosted [requester-pays](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html) S3 bucket. The steps in this guide allow any user to set up a planet vector tile server equivalent to the OSM US community vector tile [server](https://tile.ourmap.us/). Users of this service are able to take advantage of AWS's generous [free tier](https://aws.amazon.com/free/), which allows any user to host a planet tileserver for little to no cost, provided that they stay below the free tier limits.

The Tileservice bucket name is `osmus-tile` in region `us-east-2`.

With this architecture, the division of service is as follows:

**Provided by OSM US**:
1. Best-effort continuously-rendered planet updates in [PMtiles](https://docs.protomaps.com/pmtiles/) format, on an update cycle of approximately 4 hours. Service is not guaranteed, and updates may be delayed in the event of failures or during maintenance periods.
2. Requester-pays access to an S3 bucket with the planet file in the us-east-2 (Ohio) AWS zone. In the requester-pays architecture, OSM US pays the cost of S3 storage, while the requester pays for all egress traffic from the bucket.

**Required by the user**:
1. Configuration of a vector-tile server connected to the S3 bucket. OSM US recommends [Brandon Liu](https://github.com/bdon)'s [AWS guide](https://docs.protomaps.com/deploy/aws) for steps on how to configure a server.

In general, the steps are as follows:
1. Configure an AWS lambda using the protomaps AWS guide and connect it to the OSM US S3 bucket.
2. Modify the lambda code to add a RequestPayer property when accessing the bucket:
```javascript=
new GetObjectCommand({
        Bucket: process.env.BUCKET,
        Key: pmtiles_path(this.archive_name, process.env.PMTILES_PATH),
        Range: "bytes=" + offset + "-" + (offset + length - 1),
        RequestPayer: "requester"  // This line is added for requester pays
      })
```
3. Add permissions to allow the lambda to connect to the OSM US S3 bucket

At this point, the lambda should be a usable vector-tile server. Most users will optionally want to add a content delivery network (CDN) cache on top of the lambda to lower costs. This can be done with Amazon CloudFront or any other CDN. The protomaps guide linked above has instructions on how to configure CloudFront for this purpose. Users will need to decide how aggressively to set the caching on their CDN instance, as there is no explicit trigger from the OSM US side to indicate that the planet has been updated or that any individual tile has changed. 
