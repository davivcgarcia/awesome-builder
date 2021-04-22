FROM maven:3-openjdk-11 AS builder

WORKDIR /opt/src

COPY . .

RUN mvn clean package 

FROM openjdk:11

WORKDIR /opt/spring_boot

ENV ADDITIONAL_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 -Xmx1G -Xms128m -XX:MaxMetaspaceSize=128m"
ENV XRAY_OPTS="-javaagent:/opt/spring_boot/disco/disco-java-agent.jar=pluginPath=/opt/spring_boot/disco/disco-plugins"

COPY --from=builder /opt/src/target/springboot*.jar springboot_backend.jar

RUN curl -LO https://github.com/aws/aws-xray-java-agent/releases/latest/download/xray-agent.zip \
    && unzip xray-agent.zip \
    && rm -rf xray-agent.zip

SHELL ["/bin/sh", "-c"]

EXPOSE 8080

CMD java ${ADDITIONAL_OPTS} ${XRAY_OPTS} -jar springboot_backend.jar