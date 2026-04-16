db = db.getSiblingDB('gogrowsmart');

if (!db.getCollectionNames().includes('posts')) {
    db.createCollection('posts');
    print('Created posts collection');
}

if (!db.getCollectionNames().includes('post_likes')) {
    db.createCollection('post_likes');
    print('Created post_likes collection');
}

if (!db.getCollectionNames().includes('comments')) {
    db.createCollection('comments');
    print('Created comments collection');
}

if (!db.getCollectionNames().includes('teacher_bank_details')) {
    db.createCollection('teacher_bank_details');
    print('Created teacher_bank_details collection');
}

db.posts.createIndex({ "createdAt": -1 });
db.posts.createIndex({ "teacherEmail": 1 });
db.post_likes.createIndex({ "postId": 1, "userEmail": 1 }, { unique: true });
db.comments.createIndex({ "postId": 1 });

print('MongoDB initialization complete');
