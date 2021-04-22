create database IF NOT EXISTS springboot_db;

use springboot_db;

create table IF NOT EXISTS favorite (
    id int primary key auto_increment not null,
    image_url varchar(200)
);

insert ignore into favorite values(1, 'https://randomfox.ca/images/94.jpg');
insert ignore into favorite values(2, 'https://randomfox.ca/images/12.jpg');
insert ignore into favorite values(3, 'https://randomfox.ca/images/24.jpg');