import env from "./env";
import app from "./server";

app.listen(env.APP_PORT, () => {
  console.log(`Server started on ${env.APP_PORT}`);
});
