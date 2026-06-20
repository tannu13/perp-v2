import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import env from "../env";

const isDev = env.NODE_ENV === "development";
const BACKUP_FILE_NAME = "store-backup-latest.json";
export const createUploader = () => {
  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    endpoint: isDev ? env.MINIO_ENDPOINT : undefined,
    forcePathStyle: isDev,
  });

  const uploadToS3 = async (payload: any, destinationFileName: string) => {
    try {
      const jsonString = JSON.stringify(
        payload,
        (_, value) => {
          if (value instanceof Map) {
            return { _type: "Map", data: Array.from(value.entries()) };
          }
          return value;
        },
        2,
      );

      const uploadParams = {
        Bucket: env.AWS_BUCKET_NAME,
        Key: destinationFileName,
        Body: jsonString,
        ContentType: "application/json",
      };

      console.log(`uploading ${destinationFileName} to S3...`);

      const command = new PutObjectCommand(uploadParams);
      const response = await s3Client.send(command);

      // this way reading wud be always abt the latest file
      const copyCommand = new CopyObjectCommand({
        Bucket: env.AWS_BUCKET_NAME,
        CopySource: `${env.AWS_BUCKET_NAME}/${destinationFileName}`,
        Key: BACKUP_FILE_NAME,
      });
      await s3Client.send(copyCommand);

      console.log("uploaded", response);
      return response;
    } catch (error) {
      console.error("error uploading:", error);
    }
  };

  async function loadStoreFromS3() {
    const params = {
      Bucket: env.AWS_BUCKET_NAME,
      Key: BACKUP_FILE_NAME, // e.g., "backups/orderbook.json"
    };

    try {
      await s3Client.send(new HeadObjectCommand(params));

      const response = await s3Client.send(new GetObjectCommand(params));

      if (!response.Body) {
        throw new Error("response.Body is undefined");
      }
      const streamToString = await response.Body.transformToString();

      const backup = JSON.parse(streamToString, (_, value) => {
        if (value && value._type === "Map") {
          return new Map(value.data);
        }
        return value;
      });

      console.log("store backup found and loaded.");
      return backup;
    } catch (error: any) {
      if (error?.name && error?.name === "NotFound") {
        console.log("No backup file found");
        return null;
      }

      console.error("error retrieving backup:", error);
      throw error;
    }
  }

  return { uploadToS3, loadStoreFromS3 };
};
export type TUploadToS3 = ReturnType<typeof createUploader>["uploadToS3"];
